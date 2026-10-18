import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { airspaceLabel } from './layers/airspaceData.ts';
import { airspaceProxy } from '../build/airspace-proxy.js';
import { controlAvailability } from './controlAvailability.ts';
function handler() {
  let middleware;
  const postHook = airspaceProxy().configureServer({ middlewares: { use(_path, fn) { middleware = fn; return () => { throw new Error('Connect handler must not be returned as a Vite post hook'); }; } } });
  assert.equal(postHook, undefined);
  return async (query: string) => {
    let code = 0, body = '', headers = {};
    await middleware({ method: 'GET', url: `/?${query}` }, { writeHead(value, h = {}) { code = value; headers = h; }, end(value = '') { body = value; } });
    return { code, body, headers };
  };
}
const feature = { type: 'Feature', properties: { CEILING: 100, UNIT: 'Feet' }, geometry: { type: 'Polygon', coordinates: [[[-73,44],[-73,45],[-72,45],[-73,44]]] } };
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
test('ceiling labels preserve AGL units and never interpret missing values as zero', () => {
  assert.deepEqual(airspaceLabel('ceilings', { CEILING: 0, UNIT: 'Feet' }), { text: '0 ft AGL', color: '#ff9770' });
  assert.equal(airspaceLabel('ceilings', { CEILING: 200, UNIT: 'FT' }).text, '200 ft AGL');
  for (const CEILING of [null, undefined, '', '100', -1, Infinity]) assert.equal(airspaceLabel('ceilings', { CEILING, UNIT: 'Feet' }).text, 'Ceiling unknown');
  assert.equal(airspaceLabel('ceilings', { CEILING: 100, UNIT: 'm' }).text, 'Ceiling unknown');
  assert.equal(airspaceLabel('restrictions', { Facility: 'Example' }).text, 'Example');
  assert.deepEqual(airspaceLabel('sites', { SITE_NAME: 'Example flying site' }), { text: 'Example flying site', color: '#9fe8c6' });
});
test('airspace map suspends flight controls while keeping scene and satellite filters usable', () => {
  const controls = controlAvailability({ source: 'sandbox', view: 'stable', overview: true, overviewKind: 'airspace', traffic: true, trafficFollow: false, satellites: true, radar: false, vehicles: false, livePose: false });
  for (const id of ['sandbox-fly', 'sandbox-pause', 'sandbox-reset', 'follow-distance', 'replay-view', 'fov', 'traffic-follow']) assert.match(controls[id], /airspace map/);
  assert.equal(controls['scene-source'], ''); assert.equal(controls['gnss-above-only'], '');
});
test('proxy bounds queries, preserves retrieval/source timestamps, and caches a region', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const urls: string[] = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return json(String(url).includes('/query?') ? { type: 'FeatureCollection', features: [feature] } : { editingInfo: { dataLastEditDate: 1234 } });
  };
  const request = handler();
  const result = await request('kind=ceilings&lat=44.48&lon=-73.2');
  assert.equal(result.code, 200);
  const payload = JSON.parse(result.body);
  assert.equal(payload.sourceUpdatedAt, 1234); assert.ok(Number.isFinite(payload.retrievedAt));
  assert.deepEqual(payload.center, { lat: 44.5, lon: -73.2 });
  assert.equal(payload.partial, false); assert.equal(payload.features.length, 1);
  const query = new URL(urls[1]);
  assert.equal(query.searchParams.get('geometry'), '-73.7,44,-72.7,45');
  assert.equal(query.searchParams.get('outSR'), '4326');
  assert.equal(query.searchParams.get('returnZ'), 'false');
  assert.equal((await request('kind=ceilings&lat=44.48&lon=-73.2')).body, result.body);
  assert.equal(urls.length, 2);
  for (const q of ['kind=__proto__&lat=44&lon=0', 'kind=ceilings&lat=NaN&lon=0', 'kind=ceilings&lat=90&lon=0', 'kind=ceilings&lon=0']) assert.equal((await request(q)).code, 400);
});
test('proxy pages to a bounded feature budget and marks truncated coverage', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const offsets: string[] = [];
  globalThis.fetch = async url => {
    const u = new URL(String(url));
    if (u.pathname.endsWith('/query')) { offsets.push(u.searchParams.get('resultOffset')!); return json({ type: 'FeatureCollection', features: Array(1000).fill(feature), properties: { exceededTransferLimit: true } }); }
    return json({});
  };
  const response = await handler()('kind=ceilings&lat=44&lon=-73');
  const payload = JSON.parse(response.body);
  assert.equal(response.code, 200); assert.equal(payload.features.length, 4000); assert.equal(payload.partial, true);
  assert.deepEqual(offsets, ['0', '1000', '2000', '3000']);
});
test('upstream rate limits trigger cooldown even when ArcGIS responds HTTP 200', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json({ error: { code: 429, message: 'Too many requests' } }); };
  const request = handler();
  assert.equal((await request('kind=restrictions&lat=44&lon=-73')).code, 429);
  assert.equal((await request('kind=ceilings&lat=44&lon=-73')).code, 429);
  assert.equal(calls, 1);
});
test('failed and malformed responses never become empty successful coverage', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  for (const bad of [{ error: { code: 500 } }, { type: 'FeatureCollection', features: null }]) {
    globalThis.fetch = async url => json(String(url).includes('/query?') ? bad : {});
    assert.equal((await handler()('kind=restrictions&lat=44&lon=-73')).code, 502);
  }
});
