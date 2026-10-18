import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { terrainContact, createTerrainContactProbe } from './terrainContact.ts';
const pose = { latitudeDeg: 44, longitudeDeg: -73, ellipsoidHeightM: 101.5 };
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test('contact uses ellipsoid height and 1.5 m reference clearance, including below sea level', () => {
  assert.equal(terrainContact(pose, 100).contactHeightM, 101.5);
  assert.equal(terrainContact({ ...pose, ellipsoidHeightM: 100 }, 100).contactHeightM, 101.5);
  assert.equal(terrainContact({ ...pose, ellipsoidHeightM: 102 }, 100).contactHeightM, undefined);
  assert.equal(terrainContact({ ...pose, ellipsoidHeightM: -30 }, -31).contactHeightM, -29.5);
});
test('missing or invalid terrain never becomes a false sea-level collision', () => {
  for (const height of [undefined, NaN, Infinity]) assert.deepEqual(terrainContact(pose, height), {});
});
test('loaded terrain detects contact immediately while detailed sampling is pending', async () => {
  const probe = createTerrainContactProbe(async () => 100);
  assert.equal(probe.update(pose, 0, 100).contactHeightM, 101.5);
  await settle();
  assert.equal(probe.update(pose, 1).contactHeightM, 101.5);
});
test('terrain requests are bounded and one in flight; cached heights expire with distance and age', async () => {
  let calls = 0;
  let finish!: (height: number) => void;
  const probe = createTerrainContactProbe(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  probe.update(pose, 0); await settle();
  for (let now = 1; now < 1000; now++) probe.update(pose, now);
  assert.equal(calls, 1);
  finish(100); await settle();
  assert.equal(probe.update(pose, 1000).groundM, 100); await settle();
  assert.equal(calls, 2);
  assert.equal(probe.update({ ...pose, latitudeDeg: 45 }, 1100).groundM, undefined);
  assert.equal(probe.update(pose, 2100).groundM, undefined);
  finish(100); await settle();
});
test('reset or relocation cannot accept a late response from the previous flight', async () => {
  let finish!: (height: number) => void;
  const probe = createTerrainContactProbe(() => new Promise(resolve => { finish = resolve; }));
  probe.update(pose, 0); await settle();
  const oldRequest = finish;
  probe.reset();
  probe.update({ ...pose, longitudeDeg: 10 }, 1); await settle();
  oldRequest(5000); await settle();
  assert.equal(probe.update({ ...pose, longitudeDeg: 10 }, 2).groundM, undefined);
  finish(90); await settle();
  assert.equal(probe.update({ ...pose, longitudeDeg: 10 }, 3).groundM, 90);
});
test('sampling errors and non-finite responses keep loaded-terrain fallback available', async () => {
  const failed = createTerrainContactProbe(async () => { throw new Error('offline'); });
  failed.update(pose, 0); await settle();
  assert.equal(failed.update(pose, 1, 100).contactHeightM, 101.5);
  const invalid = createTerrainContactProbe(async () => NaN);
  invalid.update(pose, 0); await settle();
  assert.deepEqual(invalid.update(pose, 1), {});
});

test('every requested crash message is selectable without repeating per-frame randomization', async () => {
  const { crashMessages, randomCrashMessage } = await import('./crashMessages.ts');
  assert.equal(crashMessages.length, 8);
  for (let i = 0; i < crashMessages.length; i++)
    assert.equal(randomCrashMessage(() => (i + .5) / crashMessages.length), crashMessages[i]);
});
