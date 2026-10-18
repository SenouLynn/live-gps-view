import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { controlAvailability, type ControlContext } from './controlAvailability.ts';
const base: ControlContext = { source: 'demo', view: 'cockpit', overview: false, traffic: true, trafficFollow: false, satellites: true, radar: true, vehicles: true, livePose: true };
test('replay cockpit and follow views offer only applicable camera controls', () => {
  const cockpit = controlAvailability(base);
  assert.equal(cockpit.play, ''); assert.equal(cockpit.pitch, '');
  assert.ok(cockpit['follow-distance']);
  for (const view of ['stable', 'body', 'director']) {
    const follow = controlAvailability({ ...base, view });
    assert.equal(follow['follow-distance'], ''); assert.ok(follow.pitch);
    assert.equal(follow.altitude, '');
  }
});
test('sandbox and live sources cannot enable replay overrides', () => {
  for (const source of ['sandbox', 'live']) {
    const state = controlAvailability({ ...base, source });
    for (const id of ['play', 'restart', 'seek', 'speed', 'altitude', 'altitude-mode', 'pitch']) assert.ok(state[id], `${source}: ${id}`);
    assert.equal(state['sandbox-fly'] === '', source === 'sandbox');
    assert.equal(state['replay-view'] === '', source === 'sandbox');
  }
  assert.ok(controlAvailability({ ...base, source: 'live', livePose: false }).fov);
  assert.equal(controlAvailability({ ...base, source: 'live' }).fov, '');
});
test('camera takeovers disable flight controls across all sources and views', () => {
  for (const source of ['demo', 'sandbox', 'live']) for (const view of ['cockpit', 'stable', 'body', 'director']) {
    for (const takeover of [{ overview: true }, { trafficFollow: true }]) {
      const state = controlAvailability({ ...base, source, view, ...takeover });
      for (const id of ['play', 'altitude', 'pitch', 'replay-view', 'follow-distance', 'sandbox-fly', 'sandbox-pause', 'sandbox-reset', 'vehicle']) assert.ok(state[id], `${source}/${view}: ${id}`);
    }
  }
  const orbit = controlAvailability({ ...base, overview: true });
  assert.ok(orbit['traffic-follow']); assert.ok(orbit['scene-source']); assert.ok(orbit.fov);
  assert.equal(controlAvailability(base)['scene-source'], '');
});
test('layer options require their parent layer and recover when enabled', () => {
  const off = controlAvailability({ ...base, traffic: false, satellites: false, radar: false });
  const on = controlAvailability(base);
  for (const id of ['traffic-follow', 'aircraft-models', 'gnss-paths', 'gnss-labels', 'gnss-above-only', 'radar-opacity']) {
    assert.ok(off[id], id); assert.equal(on[id], '', id);
  }
  assert.ok(controlAvailability({ ...base, source: 'live', vehicles: false }).vehicle);
});
