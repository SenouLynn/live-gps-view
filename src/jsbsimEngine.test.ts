import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { JSBSimSdk } from '@0x62/jsbsim-wasm';
import { wasmModuleUrl, wasmBinaryUrl } from '@0x62/jsbsim-wasm/wasm';
import { createJsbsimEngine, interpolateAircraft, type AircraftControls } from './jsbsimEngine.ts';
import { initialSandboxState } from './sandboxFlight.ts';
import { createFlightSimulation } from './flightSimulation.ts';

async function engine() {
  const sdk = await JSBSimSdk.create({ moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl, log: { console: false } });
  sdk.setDebugLevel(0);
  const root = new URL('../public/flight-dynamics/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  for (const { path, sha256 } of manifest.files) {
    const data = await readFile(new URL(path, root));
    assert.equal(createHash('sha256').update(data).digest('hex'), sha256, `Asset checksum: ${path}`);
    sdk.writeDataFile(path, data);
  }
  assert.equal(sdk.loadModel('c172p'), true);
  return createJsbsimEngine(sdk, initialSandboxState());
}
const neutral = (throttle: number): AircraftControls => ({ pitch: 0, bank: 0, rudder: 0, throttle, trim: 0 });

test('real WASM C172 initializes at WGS84 start and sustains trimmed flight', async () => {
  const aircraft = await engine();
  try {
    const start = aircraft.snapshot();
    assert.ok(Math.abs(start.ellipsoidHeightM - 600) < .01);
    assert.ok(Math.abs(start.latitudeDeg - 44.4759) < 1e-8);
    assert.ok(Math.abs(start.headingDeg - 45) < .01);
    assert.ok(Math.abs(start.indicatedAirspeedKt - 100) < .01);
    assert.ok(start.trueAirspeedMps > start.indicatedAirspeedKt * .514444);
    const sim = createFlightSimulation(aircraft);
    for (let i = 0; i < 600; i++) sim.advance(neutral(start.throttle), 1 / 60);
    const end = aircraft.snapshot();
    assert.ok(Math.abs(end.timeSeconds - 10) < 1e-8);
    assert.ok(Math.abs(end.ellipsoidHeightM - 600) < 2);
    assert.ok(Math.abs(end.indicatedAirspeedKt - 100) < 1);
    assert.ok(Math.abs(end.rollDeg) < 1);
    assert.ok(end.latitudeDeg > start.latitudeDeg);
    assert.ok(Math.abs(end.climbDeg) < .5);
    assert.ok(Math.abs(end.pitchDeg - end.climbDeg) > .1, 'body pitch is distinct from flight path');
  } finally { aircraft.destroy(); }
});
test('real controls produce nose-up and right-bank responses; reset repeats initial flight', async () => {
  const aircraft = await engine();
  try {
    const start = aircraft.snapshot();
    for (let i = 0; i < 240; i++) aircraft.advance({ ...neutral(start.throttle), pitch: .5, bank: .5 }, 1 / 120);
    const turned = aircraft.snapshot();
    assert.ok(turned.pitchDeg > start.pitchDeg + 1);
    assert.ok(turned.rollDeg > start.rollDeg + 1);
    aircraft.reset(initialSandboxState());
    const reset = aircraft.snapshot();
    for (const key of ['latitudeDeg', 'longitudeDeg', 'ellipsoidHeightM', 'headingDeg', 'indicatedAirspeedKt', 'rollDeg', 'pitchDeg', 'throttle'] as const)
      assert.ok(Math.abs(reset[key] - start[key]) < .01, `${key} resets: ${reset[key]} vs ${start[key]}`);
    assert.equal(reset.timeSeconds, 0);
    aircraft.reset({ ...initialSandboxState(), latitudeDeg: -33, longitudeDeg: 151, headingDeg: 270, ellipsoidHeightM: 1200 });
    const relocated = aircraft.snapshot();
    assert.ok(Math.abs(relocated.latitudeDeg + 33) < 1e-8);
    assert.ok(Math.abs(relocated.headingDeg - 270) < .01);
    assert.ok(Math.abs(relocated.ellipsoidHeightM - 1200) < .01);
  } finally { aircraft.destroy(); }
});
test('real throttle changes energy; frame cadence and render reads cannot advance physics', async () => {
  const aircraft = await engine();
  try {
    function run(throttle: number, fps: number) {
      aircraft.reset(initialSandboxState());
      const sim = createFlightSimulation(aircraft);
      for (let i = 0; i < fps * 5; i++) {
        sim.advance(neutral(throttle), 1 / fps);
        const before = aircraft.snapshot();
        sim.render(interpolateAircraft); sim.render(interpolateAircraft);
        assert.deepEqual(aircraft.snapshot(), before);
      }
      return aircraft.snapshot();
    }
    const low = run(0, 60), high = run(1, 60);
    const energy = (s: typeof low) => 9.80665 * s.ellipsoidHeightM + s.trueAirspeedMps ** 2 / 2;
    assert.ok(energy(high) > energy(low) + 100, 'full power adds energy relative to idle');
    const at30 = run(.7, 30), at144 = run(.7, 144);
    for (const key of Object.keys(at30) as (keyof typeof at30)[])
      assert.ok(Math.abs(at30[key] - at144[key]) < .01, `render cadence: ${key}`);
  } finally { aircraft.destroy(); }
});
test('snapshot interpolation wraps headings and dateline without mutating either endpoint', async () => {
  const aircraft = await engine();
  try {
    const a = { ...aircraft.snapshot(), headingDeg: 359, courseDeg: 359, longitudeDeg: 179.9 };
    const b = { ...a, headingDeg: 1, courseDeg: 1, longitudeDeg: -179.9 };
    const mid = interpolateAircraft(a, b, .5);
    assert.equal(mid.headingDeg, 0); assert.equal(mid.courseDeg, 0);
    assert.ok(Math.abs(Math.abs(mid.longitudeDeg) - 180) < 1e-6);
    assert.equal(a.headingDeg, 359); assert.equal(b.headingDeg, 1);
  } finally { aircraft.destroy(); }
});

test('visual replay scenarios use actual engine controls and repeatable contact recordings', async () => {
  const { recordValidation, sampleValidation, validationScenarios, validationGroundM } = await import('./validationScenarios.ts');
  const aircraft = await engine();
  try {
    const records = new Map();
    for (const scenario of validationScenarios) {
      if (scenario.id !== 'figure-eight') records.set(scenario.id, recordValidation(aircraft, scenario.id));
    }
    const level = sampleValidation(records.get('straight-line'), 10);
    assert.ok(Math.abs(level.ellipsoidHeightM - 1100) < 2);
    assert.ok(Math.abs(level.rollDeg) < 1);
    const bank = sampleValidation(records.get('c172-right-bank'), 4);
    assert.ok(bank.rollDeg > 5);
    assert.ok(sampleValidation(records.get('controller-roll'), 4).rollDeg > 5, 'normalized controller input rolls the actual aircraft right');
    const energy = (id: string) => {
      const flight = sampleValidation(records.get(id), 8);
      return 9.80665 * flight.ellipsoidHeightM + flight.trueAirspeedMps ** 2 / 2;
    };
    assert.ok(energy('c172-full-power') > energy('c172-idle') + 100);
    const crash = records.get('terrain-contact');
    assert.ok(crash.impactSeconds > 2 && crash.impactSeconds < 12);
    assert.equal(sampleValidation(crash, 12).ellipsoidHeightM, validationGroundM + 1.5);
    const frozen = sampleValidation(crash, 12);
    sampleValidation(crash, 0);
    assert.deepEqual(sampleValidation(crash, 12), frozen, 'seeking backward and forward preserves the recording');
    assert.ok(sampleValidation(crash, 1).ellipsoidHeightM > validationGroundM + 90);
  } finally { aircraft.destroy(); }
});
