import * as C from 'cesium';
import { createTerrainContactProbe, type TerrainPosition } from './terrainContact.ts';

/** Both terrain sources use WGS84 ellipsoid heights; Google roofs/trees are excluded. */
export function setupSandboxTerrain(viewer: C.Viewer) {
  let provider = viewer.terrainProvider;
  const probe = createTerrainContactProbe(async position => {
    const requestedProvider = viewer.terrainProvider;
    if (requestedProvider instanceof C.EllipsoidTerrainProvider) return undefined;
    const [point] = await C.sampleTerrainMostDetailed(requestedProvider,
      [C.Cartographic.fromDegrees(position.longitudeDeg, position.latitudeDeg)], true);
    return requestedProvider === viewer.terrainProvider ? point.height : undefined;
  });
  return {
    reset() { probe.reset(); },
    update(position: TerrainPosition, nowMs: number) {
      if (provider !== viewer.terrainProvider) { provider = viewer.terrainProvider; probe.reset(); }
      const loaded = provider instanceof C.EllipsoidTerrainProvider ? undefined
        : viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(position.longitudeDeg, position.latitudeDeg));
      return probe.update(position, nowMs, loaded);
    },
  };
}
