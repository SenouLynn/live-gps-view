import * as C from 'cesium';
/** Project a directional reference, pinning it to an edge when outside the view. */
export function cameraReferencePosition(forward: C.Cartesian3, direction: C.Cartesian3, right: C.Cartesian3, up: C.Cartesian3,
  width: number, height: number, verticalFov: number) {
  const depth = C.Cartesian3.dot(forward, direction);
  let dx = C.Cartesian3.dot(forward, right), dy = -C.Cartesian3.dot(forward, up);
  const focal = height / (2 * Math.tan(verticalFov / 2));
  if (depth > 1e-6) { dx *= focal / depth; dy *= focal / depth; }
  else if (Math.hypot(dx, dy) < 1e-6) dy = 1;
  const halfWidth = Math.max(1, width / 2 - 32), halfHeight = Math.max(1, height / 2 - 32);
  const edge = depth <= 1e-6 || Math.abs(dx) > halfWidth || Math.abs(dy) > halfHeight;
  if (edge) {
    const scale = Math.min(halfWidth / Math.max(Math.abs(dx), 1e-9), halfHeight / Math.max(Math.abs(dy), 1e-9));
    dx *= scale; dy *= scale;
  }
  return { x: width / 2 + dx, y: height / 2 + dy, edge };
}
