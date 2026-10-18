import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseLocation, locationZoomHeight } from './location.ts';
import { locationProxy } from '../build/location-proxy.js';
test('location validation accepts zero and numeric input and rejects blank or invalid coordinates', () => {
  assert.deepEqual(parseLocation('0','0'),{lat:0,lon:0});
  assert.deepEqual(parseLocation('44.47','-73.2'),{lat:44.47,lon:-73.2});
  for (const [lat,lon] of [['',0],[' ',0],[true,0],[[],0],[null,0],[86,0],[0,181],[NaN,0],[0,Infinity]]) assert.equal(parseLocation(lat,lon),undefined);
});
test('zoom controls are reversible within bounds and stay above the ground', () => {
  assert.equal(locationZoomHeight(65000,.5),32500);
  assert.equal(locationZoomHeight(32500,2),65000);
  assert.equal(locationZoomHeight(200,.5),200);
  assert.equal(locationZoomHeight(20000000,2),25000000);
});
function handler() {
  let middleware;
  const plugin=locationProxy();
  const postHook=plugin.configureServer({middlewares:{use(_path,fn){middleware=fn;return () => {throw new Error('Not a Vite post hook');};}}});
  assert.equal(postHook,undefined);
  return async (q: string,method='GET')=>{
    let code=0,body='';
    await middleware({method,url:`/?${new URLSearchParams({q})}`},{writeHead(status){code=status;},end(value=''){body=value;}});
    return {code,body};
  };
}
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
test('submitted place searches return bounded valid results and reuse cache',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let calls=0;
  globalThis.fetch=async url=>{
    calls++;const u=new URL(String(url));assert.equal(u.searchParams.get('q'),'Burlington airport');assert.equal(u.searchParams.get('limit'),'5');
    return json({features:[{geometry:{type:'Point',coordinates:[-73.2,44.47]},properties:{name:'Airport',city:'Burlington',state:'Vermont',country:'USA'}},
      {geometry:{type:'Point',coordinates:['bad',44]},properties:{name:'Bad'}},
      {geometry:{type:'Point',coordinates:[0,89]},properties:{name:'Polar'}}]});
  };
  const request=handler();const result=await request('Burlington airport');
  assert.equal(result.code,200);assert.deepEqual(JSON.parse(result.body).results,[{label:'Airport, Burlington, Vermont, USA',lat:44.47,lon:-73.2}]);
  assert.equal((await request('Burlington airport')).body,result.body);assert.equal(calls,1);
  assert.equal((await request('Different query')).code,429);
});
test('invalid input and upstream failures cannot yield successful empty search results',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  let request=handler();assert.equal((await request('x')).code,400);assert.equal((await request('a'.repeat(161))).code,400);assert.equal((await request('Valid query','POST')).code,405);
  globalThis.fetch=async()=>json({error:'unavailable'});
  assert.equal((await request('Valid query')).code,502);
  request=handler();globalThis.fetch=async()=>new Response('',{status:429});
  assert.equal((await request('Valid query')).code,429);
  assert.equal((await request('Second query')).code,429);
});
