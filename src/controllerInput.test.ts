import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAxis, parseProfile, readController, type AxisBinding } from './controllerInput.ts';
const binding: AxisBinding={device:'Boxer',axis:0,min:-.8,center:.1,max:.9,reversed:false,deadzone:.05};
test('calibrated centered axes preserve endpoints, dead zone and reversal',()=>{
  assert.equal(normalizeAxis(-.8,binding),-1);
  assert.equal(normalizeAxis(.9,binding),1);
  assert.equal(normalizeAxis(.12,binding),0);
  assert.equal(normalizeAxis(.9,{...binding,reversed:true}),-1);
  assert.equal(normalizeAxis(-1,binding),-1);
  assert.ok(Math.abs(normalizeAxis(.5,binding)-(.5-.05)/.95)<1e-12);
});
test('throttle uses full calibrated travel regardless of center or deadzone',()=>{
  assert.equal(normalizeAxis(.05,binding,true),.5);
  assert.equal(normalizeAxis(-.8,binding,true),0);
  assert.equal(normalizeAxis(.9,{...binding,reversed:true},true),0);
});
test('separate HOTAS devices map correctly after browser indices change',()=>{
  const profile={pitch:binding,bank:{...binding,axis:1},throttle:{...binding,device:'Throttle'}};
  const devices=[{id:'Boxer',index:5,connected:true,axes:[.9,-.8]},{id:'Throttle',index:2,connected:true,axes:[.9]}];
  assert.deepEqual(readController(profile,devices),{pitch:1,bank:-1,throttle:1});
  assert.equal(readController(profile,devices.slice(0,1)),undefined);
  assert.equal(readController(profile,[...devices,{...devices[0],index:7}]),undefined);
  assert.equal(readController(profile,[{...devices[0],axes:[NaN,0]},devices[1]]),undefined);
});
test('unassigned optional axes preserve keyboard fallback; missing required bindings fail closed',()=>{
  const devices=[{id:'Boxer',index:0,connected:true,axes:[.1]}];
  assert.deepEqual(readController({pitch:binding,bank:binding},devices),{pitch:0,bank:0});
  assert.equal(readController({pitch:binding},devices),undefined);
  assert.equal(readController({pitch:binding,bank:{...binding,axis:9}},devices),undefined);
});
test('stored profiles reject corrupt and unsafe calibration',()=>{
  assert.deepEqual(parseProfile('broken'),{});
  assert.deepEqual(parseProfile('null'),{});
  assert.deepEqual(parseProfile(JSON.stringify({pitch:{...binding,max:.1},bank:binding,throttle:{...binding,axis:-1}})),{bank:binding});
  assert.throws(()=>normalizeAxis(NaN,binding));
});
