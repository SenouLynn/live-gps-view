import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { bearing, sampleRoute } from './pose.ts';
test('bearing preserves cardinal directions including north wrap', () => {
  assert.equal(bearing(0, 0, 1, 0), 0);
  assert.equal(bearing(0, 0, 0, 1), 90);
  assert.equal(bearing(0, 0, -1, 0), 180);
  assert.equal(bearing(0, 0, 0, -1), 270);
});
test('route clamps at endpoints and preserves explicit ellipsoid height', () => {
  assert.deepEqual(sampleRoute(-5, 450), sampleRoute(0, 450));
  assert.deepEqual(sampleRoute(125, 450), sampleRoute(120, 450));
  assert.equal(sampleRoute(15, 600).ellipsoidHeightM, 600);
  assert.ok(Math.abs(sampleRoute(15, 450).longitudeDeg - (-122.526)) < 1e-9);
});

import { terrainHeightAt, resolveHeight } from './altitude.ts';
test('AGL adds terrain height, including below-ellipsoid terrain', () => {
  assert.equal(resolveHeight('agl', 25, 300), 325);
  assert.equal(resolveHeight('agl', 25, -32), -7);
  assert.equal(resolveHeight('ellipsoid', 25, 300), 25);
  assert.equal(resolveHeight('agl', 25, undefined), undefined);
  assert.equal(resolveHeight('agl', 25, NaN), undefined);
});
test('terrain profile interpolates continuously and supports seeks and endpoints', () => {
  assert.equal(terrainHeightAt([100, 120, 80], 0.125), 110);
  assert.equal(terrainHeightAt([100, 120, 80], 0.5), 80);
  assert.equal(terrainHeightAt([100, 120, 80], 0), 100);
  assert.equal(terrainHeightAt([100, 120, 80], 900), 80);
  assert.equal(terrainHeightAt([], 0), undefined);
  assert.equal(terrainHeightAt([100, NaN], 0.125), undefined);
});

import { parseTelemetry, VehicleState, fresh, cameraAxes } from './telemetry/yalb.ts';
const observed = '2026-10-15T15:00:00Z';
function positionFrame(extra = {}, vehicleId = { systemId: 1, componentId: 1 }) {
  return JSON.stringify({ vehicleId, globalPosition: { latDeg: 37.77, lonDeg: -122.42, altMslM: 10, hdgCdeg: 9000, timeBootMs: 1000, observedAt: observed, ...extra } });
}
test('YALB protobuf JSON preserves normalized units and unknown heading', () => {
  const event = parseTelemetry(positionFrame());
  assert.equal(event?.id, '1:1');
  assert.equal(event?.kind, 'position');
  if (event?.kind === 'position') { assert.equal(event.value.msl, 10); assert.equal(event.value.heading, 90); }
  const unknown = parseTelemetry(positionFrame({ hdgCdeg: 65535 }));
  if (unknown?.kind === 'position') assert.equal(unknown.value.heading, undefined);
  const zero = parseTelemetry(JSON.stringify({ vehicleId: { systemId: 1, componentId: 1 }, globalPosition: { observedAt: observed } }));
  assert.ok(zero?.kind === 'position' && zero.value.lat === 0 && zero.value.msl === 0);
  for (const frame of ['bad json', positionFrame({ latDeg: 91 }), positionFrame({ altMslM: '10' }), positionFrame({ observedAt: 'bad' }), positionFrame({}, { systemId: 0, componentId: 1 })]) {
    assert.equal(parseTelemetry(frame), undefined);
  }
});
test('vehicle state separates identities, rejects old fixes and clears attitude on reboot', () => {
  const state = new VehicleState();
  state.accept(parseTelemetry(positionFrame())!);
  state.accept(parseTelemetry(positionFrame({ altMslM: 200, observedAt: '2026-10-15T14:59:59Z' }))!);
  assert.equal(state.vehicles.get('1:1')?.position?.msl, 10);
  state.accept(parseTelemetry(positionFrame({ altMslM: 40 }, { systemId: 2, componentId: 1 }))!);
  assert.equal(state.vehicles.get('2:1')?.position?.msl, 40);
  state.accept(parseTelemetry(JSON.stringify({ vehicleId: { systemId: 1, componentId: 1 }, attitude: { observedAt: observed, timeBootMs: 1000, yawRad: 1 } }))!);
  state.accept(parseTelemetry(positionFrame({ timeBootMs: 10, observedAt: '2026-10-15T15:00:01Z' }))!);
  assert.equal(state.vehicles.get('1:1')?.attitude, undefined);
});
test('freshness rejects stale bootstrap and future clock mismatches', () => {
  const now = Date.parse(observed);
  assert.equal(fresh(now - 3000, now), false);
  assert.equal(fresh(now + 2000, now), false);
  assert.equal(fresh(now - 100, now), true);
});
test('FRD/NED attitude maps north, east, nose-up and right-wing-down correctly', () => {
  assert.deepEqual(cameraAxes(0, 0, 0).direction, [0, 1, 0]);
  const east = cameraAxes(Math.PI / 2, 0, 0);
  assert.ok(Math.abs(east.direction[0] - 1) < 1e-12);
  assert.ok(cameraAxes(0, Math.PI / 6, 0).direction[2] > 0);
  assert.ok(cameraAxes(0, 0, Math.PI / 6).up[0] > 0);
  const { direction: d, up: u } = cameraAxes(1, 0.3, 0.7);
  assert.ok(Math.abs(d.reduce((n, x, i) => n + x * u[i], 0)) < 1e-12);
  assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-12);
  assert.ok(Math.abs(Math.hypot(...u) - 1) < 1e-12);
});
