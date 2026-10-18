import * as C from 'cesium';
import type { CameraOffset } from './cameraControls';

export interface FollowPose {
  position: C.Cartesian3;
  courseDeg: number;
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

/** Body frame: +X nose, +Y left, +Z up; positive pitch nose-up, roll right-wing-down. */
export function aircraftFrame(pose: FollowPose, stable = false) {
  return C.Transforms.headingPitchRollToFixedFrame(pose.position, new C.HeadingPitchRoll(
    C.Math.toRadians((stable ? pose.courseDeg : pose.yawDeg) - 90),
    C.Math.toRadians(stable ? 0 : pose.pitchDeg),
    C.Math.toRadians(stable ? 0 : pose.rollDeg),
  ));
}

export function followCameraPose(pose: FollowPose, stable: boolean, distance: number, elevationDeg: number, orbitYawDeg = 0) {
  const frame = aircraftFrame(pose, stable);
  const elevation = C.Math.toRadians(elevationDeg);
  const yaw = C.Math.toRadians(orbitYawDeg), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const destination = C.Matrix4.multiplyByPoint(frame,
    new C.Cartesian3(-distance * Math.cos(elevation) * cy, -distance * Math.cos(elevation) * sy, distance * Math.sin(elevation)), new C.Cartesian3());
  const direction = C.Matrix4.multiplyByPointAsVector(frame,
    new C.Cartesian3(Math.cos(elevation) * cy, Math.cos(elevation) * sy, -Math.sin(elevation)), new C.Cartesian3());
  const up = C.Matrix4.multiplyByPointAsVector(frame,
    new C.Cartesian3(Math.sin(elevation) * cy, Math.sin(elevation) * sy, Math.cos(elevation)), new C.Cartesian3());
  return { destination, orientation: { direction, up } };
}

export function setupFollowCamera(viewer: C.Viewer, orbit: () => CameraOffset = () => ({ yawDeg: 0, pitchDeg: 0 }), onReference: (position: C.Cartesian3) => void = () => {}) {
  const position = new C.ConstantPositionProperty();
  const orientation = new C.ConstantProperty();
  const aircraft = viewer.entities.add({
    name: 'Replay · Cessna 172', show: false,
    position, orientation,
    model: { uri: '/models/c172.glb', scale: 1, minimumPixelSize: 0, runAnimations: true },
  });
  return {
    hide() { aircraft.show = false; },
    update(pose: FollowPose, stable: boolean, distance: number, elevationDeg: number, cameraPose?: FollowPose) {
      aircraft.show = true;
      position.setValue(pose.position);
      const rotation = C.Matrix4.getMatrix3(aircraftFrame(pose), new C.Matrix3());
      // Cesium's Y-up and Z-forward corrections map the asset's -X nose to -Y.
      // Rotate that nose +90° into the body's +X forward direction.
      const modelRotation = C.Matrix3.multiply(rotation, C.Matrix3.fromRotationZ(Math.PI / 2), new C.Matrix3());
      orientation.setValue(C.Quaternion.fromRotationMatrix(modelRotation));
      // The clock already updated entity visualizers before scene.preUpdate.
      // Flush this pose before moving the camera so both render the same sample.
      viewer.dataSourceDisplay.update(viewer.clock.currentTime);
      const offset = orbit();
      onReference((cameraPose ?? pose).position);
      viewer.camera.setView(followCameraPose(cameraPose ?? pose, stable, distance, Math.max(-75, Math.min(85, elevationDeg + offset.pitchDeg)), offset.yawDeg));
    },
  };
}
