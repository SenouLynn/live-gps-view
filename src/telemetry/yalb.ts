/** Narrow decoder for YALB's protobuf-JSON telemetry events, independent of Cesium. */
export interface Position { lat: number; lon: number; msl: number; heading?: number; observed: number; boot: number }
export interface Attitude { roll: number; pitch: number; yaw: number; observed: number; boot: number }
export type Telemetry = { id: string } & ({ kind: 'position'; value: Position } | { kind: 'attitude'; value: Attitude });
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as ObjectValue : undefined;
function number(o: ObjectValue, key: string, fallback = 0): number {
  const value = o[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid number');
  return value;
}
export function parseTelemetry(data: string): Telemetry | undefined {
  try {
    const event = object(JSON.parse(data));
    const identity = object(event?.vehicleId);
    if (!event || !identity) return;
    const system = number(identity, 'systemId'), component = number(identity, 'componentId');
    if (![system, component].every(n => Number.isInteger(n) && n >= 1 && n <= 255)) return;
    const id = `${system}:${component}`;
    const position = object(event.globalPosition), attitude = object(event.attitude);
    const payload = position ?? attitude;
    if (!payload || typeof payload.observedAt !== 'string') return;
    const observed = Date.parse(payload.observedAt), boot = number(payload, 'timeBootMs');
    if (!Number.isFinite(observed) || boot < 0 || !Number.isInteger(boot)) return;
    if (position) {
      const lat = number(position, 'latDeg'), lon = number(position, 'lonDeg');
      const msl = number(position, 'altMslM'), hdg = number(position, 'hdgCdeg');
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isInteger(hdg) || (hdg > 35999 && hdg !== 65535) || hdg < 0) return;
      return { id, kind: 'position', value: { lat, lon, msl, observed, boot, heading: hdg === 65535 ? undefined : hdg / 100 } };
    }
    const roll = number(payload, 'rollRad'), pitch = number(payload, 'pitchRad'), yaw = number(payload, 'yawRad');
    if (Math.abs(roll) > Math.PI || Math.abs(pitch) > Math.PI / 2 || Math.abs(yaw) > Math.PI) return;
    return { id, kind: 'attitude', value: { roll, pitch, yaw, observed, boot } };
  } catch { return; }
}
export function fresh(observed: number, now: number, ttl = 2000) {
  return now - observed >= -1000 && now - observed <= ttl;
}
/** Aerospace FRD/NED attitude -> ENU camera vectors. Positive roll = right wing down. */
export function cameraAxes(yaw: number, pitch: number, roll: number) {
  const sh = Math.sin(yaw), ch = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  const sr = Math.sin(roll), cr = Math.cos(roll);
  return {
    direction: [sh * cp, ch * cp, sp],
    up: [-sh * sp * cr + ch * sr, -ch * sp * cr - sh * sr, cp * cr],
  };
}
export class VehicleState {
  vehicles = new Map<string, { position?: Position; attitude?: Attitude }>();
  accept(event: Telemetry) {
    let state = this.vehicles.get(event.id);
    if (!state) {
      if (this.vehicles.size >= 64) return;
      state = {}; this.vehicles.set(event.id, state);
    }
    const previous = event.kind === 'position' ? state.position : state.attitude;
    if (previous && event.value.observed <= previous.observed) return;
    // Reboot/backward boot time invalidates both families; never attach old attitude to a new epoch.
    if (previous && event.value.boot < previous.boot) { state.position = undefined; state.attitude = undefined; }
    if (event.kind === 'position') state.position = event.value;
    else state.attitude = event.value;
  }
}
