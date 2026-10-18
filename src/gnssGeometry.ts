import * as C from 'cesium';
/** Segment/ellipsoid occlusion, including Google mode where the terrain globe is hidden. */
export function satelliteClearOfEarth(camera:C.Cartesian3,position:C.Cartesian3){
  const delta=C.Cartesian3.subtract(position,camera,new C.Cartesian3());
  const distance=C.Cartesian3.magnitude(delta);
  if(!Number.isFinite(distance)||distance<=1)return false;
  const direction=C.Cartesian3.divideByScalar(delta,distance,new C.Cartesian3());
  const hit=C.IntersectionTests.rayEllipsoid(new C.Ray(camera,direction),C.Ellipsoid.WGS84);
  return !hit||hit.start>=distance||hit.stop<=0;
}
