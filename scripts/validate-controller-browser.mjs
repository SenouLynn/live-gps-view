import puppeteer from 'puppeteer-core';
import { strict as assert } from 'node:assert';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crashMessages } from '../src/crashMessages.ts';
const origin=process.argv[2]??'http://127.0.0.1:53144';
const label=process.argv[3]??'controller';
const evidence=process.env.FLIGHT_EVIDENCE_DIR??join(tmpdir(),'flight-sim-evidence');
await mkdir(evidence,{recursive:true});
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage();
await page.setViewport({width:1440,height:1000});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.setRequestInterception(true);
page.on('request',request=>{const url=request.url();if(url.includes('/api/'))return void request.respond({status:503,body:'External data disabled in validation'});void (url.startsWith(origin)||url.startsWith('blob:')||url.startsWith('data:')?request.continue():request.abort());});
const text=id=>page.$eval(`#${id}`,el=>el.textContent);
const wait=ms=>page.evaluate(ms=>new Promise(resolve=>setTimeout(resolve,ms)),ms);
await page.evaluateOnNewDocument(()=>{
  window.testControllers=[{id:'Test Boxer',index:0,connected:true,axes:[0,0,0]},{id:'Test HOTAS throttle',index:1,connected:true,axes:[0]}];
  Object.defineProperty(navigator,'getGamepads',{value:()=>window.testControllers});
});
const simTime=async()=>Number((await text('time')).match(/([\d.]+) s/)?.[1]);
try{
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#startup[open]');
  await page.click('input[value="sandbox/physics-flight"]');await page.click('#startup-action');
  await page.waitForFunction(()=>document.querySelector('#physics-status').dataset.phase==='ready');
  await page.click('#controller-setup');await page.waitForSelector('#controller-dialog[open]');
  for(const [axis,index] of [['Pitch',0],['Roll',1],['Rudder',2]])
    await page.select(`select[aria-label="${axis} device and axis"]`,JSON.stringify(['Test Boxer',index]));
  await page.select('select[aria-label="Throttle device and axis"]',JSON.stringify(['Test HOTAS throttle',0]));
  // Exercise actual endpoint/center capture and persistence, beyond pure mapping tests.
  for(const [value,position] of [[-.7,1],[.8,3],[.04,2]]) {
    await page.evaluate(value=>{window.testControllers[0].axes[0]=value;},value);
    await page.click(`#controller-rows fieldset:first-child .row-actions button:nth-child(${position})`);
  }
  await page.evaluate(()=>{window.testControllers[0].axes[0]=.04;});
  await page.screenshot({path:join(evidence,`${label}-controller-setup.png`)});
  await page.click('#controller-save');
  assert.equal(await page.$eval('#controller-dialog',el=>el.open),false);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('synthetic-fpv.controllers.v1')));
  assert.equal(saved.pitch.min,-.7);assert.equal(saved.pitch.max,.8);assert.equal(saved.pitch.center,.04);
  await page.click('#controller-enable');
  assert.equal(await text('sandbox-pause'),'Resume');
  await page.click('#sandbox-pause');
  await page.evaluate(()=>{window.testControllers[0].axes[1]=.6;window.testControllers[1].axes[0]=1;});
  await page.waitForFunction(()=>document.querySelector('#pose-note').textContent.match(/bank [1-9]/));
  assert.equal(await page.$eval('#physics-throttle',el=>el.value),'100');
  assert.equal(await page.$eval('#physics-throttle',el=>el.disabled),true);
  await page.evaluate(()=>{window.testControllers[1].connected=false;});
  await page.waitForFunction(()=>document.querySelector('#sandbox-pause').textContent==='Resume');
  await wait(200);const stopped=await simTime();await wait(300);assert.equal(await simTime(),stopped);
  assert.equal(await page.$eval('#controller-enable',el=>el.checked),false);
  assert.match(await text('controller-status'),/lost|disconnected/);
  await page.evaluate(()=>{window.testControllers[1].connected=true;window.testControllers[0].axes[1]=0;});
  await page.click('#controller-enable');await page.click('#sandbox-pause');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  assert.equal(await page.$eval('#controller-enable',el=>el.checked),false);
  assert.equal(await text('sandbox-pause'),'Resume');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#controller-setup');
  assert.equal(await page.$eval('#controller-enable',el=>el.checked),false,'reload never automatically activates a device');
  await page.click('#controller-setup');
  assert.equal(await page.$eval('select[aria-label="Throttle device and axis"]',el=>el.value),JSON.stringify(['Test HOTAS throttle',0]));
  await page.click('#controller-close');
  await page.click('#sandbox-pause');await page.click('#sandbox-fly');
  await page.keyboard.down('ArrowRight');await wait(400);await page.keyboard.up('ArrowRight');
  await page.waitForFunction(()=>document.querySelector('#pose-note').textContent.match(/bank [1-9]/));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'passed',checks:'multi-device setup, real engine roll/throttle, disconnect pause, focus pause, persisted mappings with explicit reactivation, keyboard recovery',errors,evidence}));
} catch(error) {
  await page.screenshot({path:join(evidence,`${label}-controller-failure.png`)}).catch(()=>{});
  console.error(await text('controller-status').catch(()=>''));throw error;
} finally {await browser.close();}
