import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createFlightSimulation } from './flightSimulation.ts';
import { createSandboxEngine, initialSandboxState, stepSandbox } from './sandboxFlight.ts';

const input = { pitch: .4, bank: .6 };
function simulation() {
  return createFlightSimulation(createSandboxEngine(initialSandboxState()));
}
test('fixed clock produces identical flight at 30, 60 and 144 render FPS', () => {
  const results = [30, 60, 144].map(fps => {
    const sim = simulation();
    for (let i = 0; i < fps * 10; i++) sim.advance(input, 1 / fps);
    return sim.snapshot();
  });
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0], results[2]);
  assert.ok(Math.abs(results[0].timeSeconds - 10) < 1e-9);
});
test('adapter matches existing model, and reading or editing snapshots cannot advance or mutate flight', () => {
  const sim = simulation();
  sim.advance(input, 1 / 120);
  const expected = stepSandbox(initialSandboxState(), input, 1 / 120);
  assert.deepEqual(sim.snapshot(), expected);
  sim.snapshot().latitudeDeg = 0;
  assert.deepEqual(sim.snapshot(), expected);
});
test('pause clearing and reset discard partial steps and reset the engine pose', () => {
  const sim = simulation();
  sim.advance(input, 1 / 240);
  sim.clearElapsed();
  sim.advance(input, 1 / 240);
  assert.equal(sim.snapshot().timeSeconds, 0);
  const start = { ...initialSandboxState(), headingDeg: 180, latitudeDeg: 30 };
  sim.reset(start);
  start.latitudeDeg = 0;
  assert.equal(sim.snapshot().latitudeDeg, 30);
  assert.equal(sim.snapshot().headingDeg, 180);
  assert.equal(sim.remainderSeconds, 0);
});
test('long stalls are capped and invalid elapsed times leave the clock unchanged', () => {
  const sim = simulation();
  for (const dt of [NaN, Infinity, -1]) sim.advance(input, dt);
  assert.equal(sim.snapshot().timeSeconds, 0);
  sim.advance(input, 60);
  assert.ok(Math.abs(sim.snapshot().timeSeconds - .1) < 1e-12);
});
