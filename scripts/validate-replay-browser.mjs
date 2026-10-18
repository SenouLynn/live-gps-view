import puppeteer from 'puppeteer-core';
import { strict as assert } from 'node:assert';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crashMessages } from '../src/crashMessages.ts';
const origin=process.argv[2]??'http://127.0.0.1:53144';
const label=process.argv[3]??'dev';
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
async function choose(id){
  await page.select('#validation-scenario',id);
  await page.waitForFunction(id=>document.querySelector('#validation-status').dataset.phase==='ready'&&document.querySelector('#validation-status').dataset.scenario===id,{timeout:30000},id);
  await wait(200);
}
try{
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#startup[open]');
  await page.click('input[value="demo/demo-replay"]');await page.click('#startup-action');
  await page.waitForSelector('#validation-controls:not([hidden])');
  assert.equal(await page.$$eval('#validation-scenario option',els=>els.length),6);
  assert.deepEqual(await page.$$eval('#validation-scenario optgroup',els=>els.map(el=>el.label)),['Routes','Feature enhancements']);
  await page.select('#replay-view','body');
  for(const id of ['straight-line','c172-idle','c172-full-power','c172-right-bank']){
    await choose(id);
    assert.equal(await page.$eval('#seek',el=>el.max),'12');
    assert.equal(await page.$eval('#altitude',el=>el.disabled),true);
    assert.match(await text('telemetry-status'),/C172 · IAS/);
    assert.match(await text('height-detail'),/Flat test surface 1000 m/);
    await page.$eval('#seek',el=>{el.value='4';el.dispatchEvent(new Event('input',{bubbles:true}));});await wait(200);
    if(id==='c172-right-bank')assert.match(await text('pose-note'),/bank [1-9]/);
  }
  await choose('terrain-contact');
  await page.screenshot({path:join(evidence,`${label}-validation-scenario.png`)});
  await page.$eval('#seek',el=>{el.value='10';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForSelector('#sandbox-crash[open]');
  const message=await text('sandbox-crash-title');assert.ok(crashMessages.includes(message));
  await wait(300);assert.equal(await text('sandbox-crash-title'),message,'message is chosen once per crash');
  assert.equal(await page.$eval('#play',el=>el.dataset.state),'paused');
  await page.screenshot({path:join(evidence,`${label}-validation-crash.png`)});
  await page.click('#sandbox-crash-reset');await wait(200);
  assert.equal(await page.$eval('#sandbox-crash',el=>el.open),false);
  assert.equal(await text('replay-elapsed'),'00:00');
  assert.equal(await page.$eval('#play',el=>el.dataset.state),'playing');
  await page.click('#play');await wait(100);const held=await text('replay-elapsed');await wait(300);assert.equal(await text('replay-elapsed'),held);
  await page.select('#validation-scenario','figure-eight');await wait(200);
  assert.equal(await page.$eval('#seek',el=>el.max),'120');
  assert.equal(await page.$eval('#altitude',el=>el.disabled),false);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({label,result:'passed',assertions:'six visible replay options, real engine scenarios, transport duration, seek, recorded altitude ownership, contact overlay, random message stability, overlay reset, pause, original replay restoration',errors,evidence},null,2));
}catch(error){await page.screenshot({path:join(evidence,`${label}-replay-failure.png`)}).catch(()=>{});console.error(JSON.stringify({errors,status:await text('validation-status').catch(()=>''),telemetry:await text('telemetry-status').catch(()=>'')}));throw error;}
finally{await browser.close();}
