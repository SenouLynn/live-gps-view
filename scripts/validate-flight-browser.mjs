import puppeteer from 'puppeteer-core';
import { strict as assert } from 'node:assert';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Usage: CHROME_PATH=/path/to/chrome node scripts/validate-flight-browser.mjs http://127.0.0.1:53142 dev
const origin = process.argv[2] ?? 'http://127.0.0.1:53142';
const label = process.argv[3] ?? 'dev';
const evidence = process.env.FLIGHT_EVIDENCE_DIR ?? join(tmpdir(), 'flight-sim-evidence');
await mkdir(evidence, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const requests = [];
await page.setRequestInterception(true);
let failAssets = false, delayAssets = false;
page.on('request', request => {
  const url = request.url();
  if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) return void request.abort();
  if (failAssets && url.includes('/flight-dynamics/engine/eng_io320.xml')) return void request.respond({ status: 503, body: 'test unavailable' });
  if (delayAssets && url.includes('/flight-dynamics/engine/eng_io320.xml')) {
    setTimeout(() => { void request.continue().catch(() => {}); }, 600); return;
  }
  if (/jsbsim|flight-dynamics/.test(url)) requests.push(url.split('?')[0]);
  void request.continue();
});
const wait = ms => page.evaluate(ms => new Promise(resolve => setTimeout(resolve, ms)), ms);
const text = id => page.$eval(`#${id}`, element => element.textContent);
const simTime = async () => Number((await text('time')).match(/([\d.]+) s/)?.[1]);
const ready = () => page.waitForFunction(() => document.querySelector('#physics-status')?.dataset.phase === 'ready', { timeout: 30000 });
try {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#startup[open]');
  assert.equal(await page.$eval('input[value="sandbox/keyboard-flight"]', el => el.disabled), false);
  assert.equal(await page.$eval('input[value="sandbox/physics-flight"]', el => el.disabled), false);
  // Select Physics Engine through the real setup flow.
  await page.click('input[value="sandbox/physics-flight"]');
  await page.click('#startup-action');
  await ready();
  await page.waitForFunction(() => document.querySelector('#physics-readout').textContent.startsWith('IAS'));
  assert.match(await text('vehicle-title'), /PHYSICS ENGINE/);
  assert.match(await text('physics-readout'), /IAS 100\./);
  assert.equal(await page.$eval('#sandbox-mode', el => el.value), 'physics');
  const loadedAt = await simTime();
  await wait(500);
  assert.ok(await simTime() > loadedAt, 'physics time advances');
  await page.click('#sandbox-pause'); await wait(200);
  const pausedAt = await simTime();
  await wait(400);
  assert.equal(await simTime(), pausedAt, 'pause freezes the engine');
  await page.screenshot({ path: `${evidence}/${label}-physics.png` });
  await page.click('#physics-hangar');
  await page.waitForSelector('#hangar-dialog[open]');
  assert.equal(await page.$$eval('#hangar-catalog button', els => els.length), 1);
  assert.match(await text('hangar-title'), /Physics/);
  await page.waitForFunction(() => document.querySelector('#hangar-status').textContent.startsWith('Drag to orbit'), { timeout: 20000 });
  await page.screenshot({ path: `${evidence}/${label}-hangar.png` });
  await page.click('#hangar-use');
  await ready(); await wait(200);
  assert.ok(await simTime() < 2, 'hangar selection starts a fresh C172 flight');
  // Direct controls, then reset. Arrow direction is also measured in real-engine tests.
  await page.click('#sandbox-fly');
  await page.keyboard.down('ArrowRight'); await wait(350); await page.keyboard.up('ArrowRight');
  await page.click('#sandbox-reset'); await ready();
  await page.focus('#physics-throttle'); await page.keyboard.press('End');
  assert.equal(await page.$eval('#physics-throttle', el => el.value), '100');
  await page.focus('#physics-trim'); await page.keyboard.press('ArrowRight');
  assert.match(await text('physics-trim-label'), /\+1/);
  for (const view of ['stable', 'body', 'director', 'cockpit']) {
    await page.select('#replay-view', view); await wait(200);
    assert.match(await text('telemetry-status'), /Physics Engine/);
    if (view === 'director') assert.match(await text('fd-command-read'), /unavailable|none|—/i);
  }
  await page.click('#location-open');
  await page.waitForSelector('#location-dialog[open]');
  await page.waitForFunction(() => !document.querySelector('#location-use').disabled);
  await wait(200); const dialogTime = await simTime(); await wait(300);
  assert.equal(await simTime(), dialogTime, 'location dialog suspends flight');
  await page.$eval('#location-lat', el => { el.value = '43'; });
  await page.$eval('#location-lon', el => { el.value = '-72'; });
  await page.click('#location-use'); await ready(); await wait(200);
  assert.match(await text('position'), /^43\.00/);
  assert.ok(await simTime() < 2, 'relocation resets physics time');
  await page.select('#sandbox-mode', 'simple'); await wait(200);
  assert.match(await text('vehicle-title'), /SIMPLE FREE FLIGHT/);
  await page.click('#sandbox-pause'); await wait(200);
  const simpleSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('synthetic-fpv.application.v1')).sandbox.current);
  await page.select('#sandbox-mode', 'physics'); await ready(); await wait(300);
  await page.click('#sandbox-pause'); await wait(200);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('synthetic-fpv.application.v1')).sandbox.current), simpleSaved, 'physics cannot overwrite simple progress');
  await page.select('#sandbox-mode', 'simple'); await wait(200);
  assert.equal(await text('sandbox-pause'), 'Resume', 'simple pause state is independent');
  delayAssets = true;
  await page.select('#sandbox-mode', 'physics');
  await page.select('#sandbox-mode', 'simple');
  await wait(1000);
  assert.equal(await page.$eval('#sandbox-mode', el => el.value), 'simple', 'late load cannot change modes');
  delayAssets = false;
  // Existing visual hangar stays independent and still lists all eight models.
  await page.click('#hangar-open');
  assert.equal(await page.$$eval('#hangar-catalog button', els => els.length), 8);
  await page.click('#hangar-close');
  // Exercise an actual asset failure and retry, without a synthetic flight fallback.
  failAssets = true;
  await page.select('#sandbox-mode', 'physics');
  await page.waitForFunction(() => document.querySelector('#physics-status').dataset.phase === 'failed');
  assert.match(await text('physics-status'), /unavailable/);
  assert.equal(await page.$eval('#physics-throttle', el => el.disabled), true);
  failAssets = false;
  await page.click('#sandbox-reset'); await ready();
  await page.click('#sandbox-pause'); await wait(200);
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
  assert.equal(await page.$eval('#sandbox-mode', el => el.value), 'physics');
  assert.ok(await simTime() < 2, 'reload starts a fresh trimmed physics flight');
  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
  assert.ok(requests.some(url => url.endsWith('.wasm')), 'real WASM binary loaded');
  console.log(JSON.stringify({ label, result: 'passed', assertions: 'setup, WASM load, flight clock, pause, 3D hangar, controls, throttle/trim, all views, location suspension/relocation, reset, mode isolation, loading race, visual catalog, asset failure/retry, reload', browserErrors: errors, evidence }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${evidence}/${label}-failure.png` }).catch(() => {});
  console.error(JSON.stringify({ phase: await text('physics-status').catch(() => ''), hud: await text('telemetry-status').catch(() => ''), browserErrors: errors }));
  throw error;
} finally { await browser.close(); }
