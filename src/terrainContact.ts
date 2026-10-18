export interface TerrainPosition {
  latitudeDeg: number;
  longitudeDeg: number;
  ellipsoidHeightM: number;
}
export interface TerrainContact {
  groundM?: number;
  clearanceM?: number;
  contactHeightM?: number;
}
export const aircraftGroundClearanceM = 1.5;

/** A deliberately simple aircraft reference-point clearance, not wheel/mesh collision. */
export function terrainContact(position: TerrainPosition, groundM: number | undefined): TerrainContact {
  if (groundM === undefined || !Number.isFinite(groundM)) return {};
  const clearanceM = position.ellipsoidHeightM - groundM;
  return { groundM, clearanceM,
    contactHeightM: clearanceM <= aircraftGroundClearanceM ? groundM + aircraftGroundClearanceM : undefined };
}

function separationM(a: TerrainPosition, b: TerrainPosition) {
  const rad = Math.PI / 180;
  const longitudeDelta = ((a.longitudeDeg - b.longitudeDeg + 540) % 360) - 180;
  return Math.hypot((a.latitudeDeg - b.latitudeDeg) * 111320,
    longitudeDelta * 111320 * Math.cos((a.latitudeDeg + b.latitudeDeg) * rad / 2));
}

/** Bound sampling work and never reuse an old location's height after reset/relocation.
 * Most-detailed samples are approximate between requests (at most 40 m / 2 seconds).
 * Loaded terrain at the current position is the fallback while a request is pending.
 */
export function createTerrainContactProbe(sample: (position: TerrainPosition) => Promise<number | undefined>) {
  let generation = 0, pending = false, lastRequest = -Infinity;
  let cached: { position: TerrainPosition; groundM: number; receivedAt: number } | undefined;
  return {
    reset() { generation++; pending = false; lastRequest = -Infinity; cached = undefined; },
    update(position: TerrainPosition, nowMs: number, loadedHeightM?: number): TerrainContact {
      if (!pending && nowMs - lastRequest >= 250) {
        pending = true; lastRequest = nowMs;
        const epoch = generation, requested = { ...position };
        let timeout: ReturnType<typeof setTimeout> | undefined;
        void Promise.race([
          Promise.resolve().then(() => sample(requested)),
          new Promise<undefined>(resolve => { timeout = setTimeout(() => resolve(undefined), 5000); }),
        ]).then(height => {
          if (generation === epoch && height !== undefined && Number.isFinite(height))
            cached = { position: requested, groundM: height, receivedAt: nowMs };
        }).catch(() => { /* Missing terrain never becomes a zero-height surface. */ })
          .finally(() => { clearTimeout(timeout); if (generation === epoch) pending = false; });
      }
      const fresh = cached && nowMs - cached.receivedAt <= 2000 && separationM(position, cached.position) <= 40;
      return terrainContact(position, fresh && cached ? cached.groundM : loadedHeightM);
    },
  };
}
