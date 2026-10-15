/** Terrain profile matches the deterministic demo timeline; heights are ellipsoidal meters. */
export const terrainStepSeconds = 0.25;
export function terrainHeightAt(heights: readonly number[], seconds: number): number | undefined {
  if (!heights.length || !Number.isFinite(seconds)) return undefined;
  const index = Math.max(0, Math.min(heights.length - 1, seconds / terrainStepSeconds));
  const lower = Math.floor(index), upper = Math.ceil(index);
  if (!Number.isFinite(heights[lower]) || !Number.isFinite(heights[upper])) return undefined;
  return heights[lower] + (heights[upper] - heights[lower]) * (index - lower);
}
export function resolveHeight(mode: string, altitudeM: number, groundM: number | undefined): number | undefined {
  if (!Number.isFinite(altitudeM)) return undefined;
  if (mode === 'ellipsoid') return altitudeM;
  if (mode !== 'agl' || groundM === undefined || !Number.isFinite(groundM)) return undefined;
  return altitudeM + groundM;
}
