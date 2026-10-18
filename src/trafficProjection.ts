import * as C from 'cesium';

/** Cesium's screen projection normalizes eye-space position; never pass the eye origin. */
export function projectTrafficPoint(
  scene: C.Scene,
  world: C.Cartesian3,
  selected: boolean,
  project = C.SceneTransforms.worldToWindowCoordinates,
): C.Cartesian2 | undefined {
  if (selected) return undefined;
  const relative = C.Cartesian3.subtract(world, scene.camera.positionWC, new C.Cartesian3());
  if (![relative.x, relative.y, relative.z].every(Number.isFinite) || C.Cartesian3.magnitudeSquared(relative) <= 1 || C.Cartesian3.dot(relative, scene.camera.directionWC) <= 0) return undefined;
  return project(scene, world);
}
