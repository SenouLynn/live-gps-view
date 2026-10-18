import puppeteer from 'puppeteer-core';
import { strict as assert } from 'node:assert';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crashMessages } from '../src/crashMessages.ts';

const origin = process.argv[2] ?? 'http://127.0.0.1:53144';
const label = process.argv[3] ?? 'dev';
const evidence = process.env.FLIGHT_EVIDENCE_DIR ?? join(tmpdir(), 'flight-sim-evidence');
await mkdir(evidence, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let terrainOnline = true, tileRequests = 0;
// Real Cesium heightmap-1.0 data: two flat root tiles at 0 m ellipsoid height.
// Only the remote terrain data is replaced; app, Cesium and JSBSim code run unchanged.
const tile = Buffer.alloc(65 * 65 * 2 + 2);
for (let i = 0; i < 65 * 65; i++) tile.writeUInt16LE(5000, i * 2); // 5000 * 0.2 - 1000 = 0 m
const metadata = {
  tilejson: '2.1.0', format: 'heightmap-1.0', version: '1', scheme: 'tms', projection: 'EPSG:4326',
  tiles: ['{z}/{x}/{y}.terrain'], maxzoom: 0,
  available: [[{ startX: 0, startY: 0, endX: 1, endY: 0 }]],
};
await page.setRequestInterception(true);
page.on('request', request => {
  const url = request.url();
  if (url.startsWith('https://terrain.reearth.land/')) {
    if (!terrainOnline) return void request.abort();
    const headers = { 'access-control-allow-origin': '*' };
    if (url.includes('layer.json')) return void request.respond({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(metadata) });
    tileRequests++;
    return void request.respond({ status: 200, contentType: 'application/octet-stream', headers, body: tile });
  }
  if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) return void request.abort();
  void request.continue();
});
const text = id => page.$eval(`#${id}`, el => el.textContent);
const time = async () => Number((await text('time')).match(/([\d.]+) s/)?.[1]);
const wait = ms => page.evaluate(ms => new Promise(resolve => setTimeout(resolve, ms)), ms);
try {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#startup[open]');
  await page.click('input[value="sandbox/physics-flight"]');
  await page.$eval('#start-height', el => { el.value = '100'; });
  await page.click('#startup-action');
  await page.waitForFunction(() => document.querySelector('#physics-status').dataset.phase === 'ready');
  await page.waitForFunction(() => document.querySelector('#height-detail').textContent.includes('Ground 0 m'), { timeout: 30000 });
  await page.click('#sandbox-fly');
  await page.keyboard.down('ArrowDown');
  await page.waitForFunction(() => document.querySelector('#height-detail').dataset.contact === 'true', { timeout: 30000 });
  await page.keyboard.up('ArrowDown');
  await wait(200);
  assert.equal(await text('alt-read'), '2 m'); // 1.5 m reference clearance, rounded in the main HUD
  assert.match(await text('telemetry-status'), /terrain contact/);
  await page.waitForSelector('#sandbox-crash[open]');
  assert.ok(crashMessages.includes(await text('sandbox-crash-title')));
  assert.equal(await page.$eval('#sandbox-crash-reset', el => document.activeElement === el), true);
  assert.equal(await page.$eval('#sandbox-pause', el => el.disabled), true);
  const atImpact = await time(), position = await text('position');
  // Move focus to the dialog itself: Space must not accidentally activate Reset.
  await page.$eval('#sandbox-crash', el => { el.tabIndex = -1; el.focus(); });
  await page.keyboard.press('Space'); await page.keyboard.press('Escape'); await wait(500);
  assert.equal(await page.$eval('#sandbox-crash', el => el.open), true);
  assert.equal(await time(), atImpact, 'Space cannot restart a contact-stopped engine');
  assert.equal(await text('position'), position, 'contact holds aircraft position');
  await page.screenshot({ path: join(evidence, `${label}-terrain-contact.png`) });
  await page.click('#sandbox-crash-reset'); await wait(500);
  assert.equal(await page.$eval('#sandbox-crash', el => el.open), false);
  assert.equal(await page.$eval('#height-detail', el => el.dataset.contact), 'false');
  assert.equal(await text('alt-read'), '100 m');
  assert.ok(await time() < atImpact, 'Reset starts a fresh airborne flight');
  assert.equal(await page.$eval('#sandbox-pause', el => el.disabled), false);
  // Simple mode remains the independent assisted sandbox.
  await page.select('#sandbox-mode', 'simple'); await wait(200);
  assert.match(await text('telemetry-status'), /Simple Free Flight/);
  assert.equal(await page.$eval('#height-detail', el => el.dataset.contact), 'false');
  // Reload with failed terrain: no fabricated sea-level ground or false collision.
  terrainOnline = false;
  await page.select('#sandbox-mode', 'physics');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#physics-status').dataset.phase === 'ready');
  await page.waitForFunction(() => document.querySelector('#height-detail').textContent.includes('collision unavailable'));
  const before = await time(); await wait(500);
  assert.ok(await time() > before, 'missing terrain is reported without freezing flight');
  assert.ok(tileRequests > 0, 'Cesium fetched and sampled actual terrain tile data');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ label, result: 'passed', impactTimeSeconds: atImpact, tileRequests,
    assertions: 'real-engine descent/contact, frozen time/position, clearance, resume blocked, accessible crash overlay, overlay reset, simple isolation, missing terrain', errors, evidence }, null, 2));
} catch (error) {
  await page.screenshot({ path: join(evidence, `${label}-terrain-failure.png`) }).catch(() => {});
  console.error(JSON.stringify({ ground: await text('height-detail').catch(() => ''), physics: await text('physics-status').catch(() => ''), tileRequests, errors }));
  throw error;
} finally { await browser.close(); }
