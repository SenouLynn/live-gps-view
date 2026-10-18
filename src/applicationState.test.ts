import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { decodeState, defaultState } from './applicationState.ts';
test('missing, corrupt, or unsupported sessions return to startup', () => {
  for (const raw of [null, '{', 'null', '{"version":2}', '{"version":1,"workflow":"invalid"}']) {
    assert.deepEqual(decodeState(raw), defaultState());
  }
});
test('saved workflow, settings, and progress survive a round trip', () => {
  const saved = defaultState();
  saved.screen = 'workspace'; saved.workflow = 'demo';
  saved.controls = { 'replay-view': 'stable', 'follow-distance': '75', 'traffic-enabled': false };
  saved.replay = { time: 57.5, playing: false };
  saved.sandbox.current.longitudeDeg = -72;
  saved.sandbox.current.timeSeconds = 40;
  saved.sandbox.paused = true;
  assert.deepEqual(decodeState(JSON.stringify(saved)), saved);
});
test('invalid progress is bounded and invalid sandbox poses fall back independently', () => {
  const saved = defaultState();
  saved.screen = 'workspace';
  saved.replay.time = 999;
  saved.sandbox.current.latitudeDeg = 100;
  const restored = decodeState(JSON.stringify(saved));
  assert.equal(restored.screen, 'workspace');
  assert.equal(restored.replay.time, 120);
  assert.deepEqual(restored.sandbox.current, defaultState().sandbox.current);
});
test('old sandbox sessions default to simple and physics mode preserves independent simple progress', () => {
  const legacy = JSON.parse(JSON.stringify(defaultState()));
  delete legacy.sandbox.mode;
  assert.equal(decodeState(JSON.stringify(legacy)).sandbox.mode, 'simple');
  legacy.sandbox.mode = 'unknown';
  assert.equal(decodeState(JSON.stringify(legacy)).sandbox.mode, 'simple');
  legacy.sandbox.mode = 'physics';
  legacy.sandbox.current.timeSeconds = 75;
  const restored = decodeState(JSON.stringify(legacy));
  assert.equal(restored.sandbox.mode, 'physics');
  assert.equal(restored.sandbox.current.timeSeconds, 75);
});
