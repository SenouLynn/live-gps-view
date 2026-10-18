import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as C from 'cesium';
import { stepCameraOffset } from './cameraControls.ts';
import { followCameraPose } from './followCamera.ts';
test('camera input changes only its own offsets and cancels opposing keys', () => {
  const initial = { yawDeg: 0, pitchDeg: 0 };
  assert.deepEqual(stepCameraOffset(initial, 1, 1, .1), { yawDeg: 6, pitchDeg: 4.5 });
  assert.deepEqual(initial, { yawDeg: 0, pitchDeg: 0 });
  assert.deepEqual(stepCameraOffset(initial, 0, 0, .1), initial);
});
test('camera rotation is frame-rate independent and bounds long frames and vertical look', () => {
  let fine = { yawDeg: 0, pitchDeg: 0 }, coarse = { ...fine };
  for (let i = 0; i < 120; i++) fine = stepCameraOffset(fine, 1, 1, 1/120);
  for (let i = 0; i < 60; i++) coarse = stepCameraOffset(coarse, 1, 1, 1/60);
  assert.ok(Math.abs(fine.yawDeg - coarse.yawDeg) < 1e-8);
  assert.ok(Math.abs(fine.pitchDeg - coarse.pitchDeg) < 1e-8);
  assert.deepEqual(stepCameraOffset({ yawDeg: 179, pitchDeg: 74 }, 1, 1, 10), { yawDeg: -175, pitchDeg: 75 });
  assert.deepEqual(stepCameraOffset({ yawDeg: -179, pitchDeg: -74 }, -1, -1, .1), { yawDeg: 175, pitchDeg: -75 });
});
test('follow orbit preserves aircraft pose and follow distance and points at the aircraft', () => {
  const pose = { position: C.Cartesian3.fromDegrees(-73.2,44.5,600), courseDeg: 45, yawDeg: 45, pitchDeg: 10, rollDeg: 20 };
  const original = structuredClone(pose);
  for (const stable of [true, false]) for (const yaw of [-180,-90,0,90,179]) for (const elevation of [-75,0,45,85]) {
    const camera = followCameraPose(pose, stable, 70, elevation, yaw);
    assert.ok(Math.abs(C.Cartesian3.distance(camera.destination, pose.position)-70)<1e-7);
    const toAircraft = C.Cartesian3.normalize(C.Cartesian3.subtract(pose.position, camera.destination, new C.Cartesian3()), new C.Cartesian3());
    assert.ok(C.Cartesian3.dot(toAircraft,camera.orientation.direction)>1-1e-10);
    assert.ok(Math.abs(C.Cartesian3.dot(camera.orientation.up,camera.orientation.direction))<1e-10);
  }
  assert.deepEqual(structuredClone(pose),original);
});

test('hold look retains released offsets while return-forward smoothly settles each released axis', () => {
  const offset = { yawDeg: 50, pitchDeg: -30 };
  assert.deepEqual(stepCameraOffset(offset, 0, 0, .1), offset);
  const returning = stepCameraOffset(offset, 0, 0, .1, true);
  assert.ok(returning.yawDeg > 0 && returning.yawDeg < offset.yawDeg);
  assert.ok(returning.pitchDeg < 0 && returning.pitchDeg > offset.pitchDeg);
  const oneAxis = stepCameraOffset(offset, 1, 0, .1, true);
  assert.equal(oneAxis.yawDeg, 56); assert.ok(oneAxis.pitchDeg > offset.pitchDeg);
  let settled = offset;
  for (let i=0;i<240;i++) settled = stepCameraOffset(settled,0,0,1/60,true);
  assert.deepEqual(settled,{yawDeg:0,pitchDeg:0});
});
