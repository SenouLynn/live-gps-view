export const flightAxes = ['pitch', 'bank', 'rudder', 'throttle'] as const;
export type FlightAxis = typeof flightAxes[number];
export interface AxisBinding {
  device: string; axis: number; min: number; center: number; max: number; reversed: boolean; deadzone: number;
}
export type ControllerProfile = Partial<Record<FlightAxis, AxisBinding>>;
export interface ControllerDevice { id: string; index: number; connected: boolean; axes: readonly number[] }
export const controllerStorageKey = 'synthetic-fpv.controllers.v1';
export function validBinding(value: unknown): value is AxisBinding {
  if (!value || typeof value !== 'object') return false;
  const b = value as AxisBinding;
  return typeof b.device === 'string' && b.device.length > 0 && Number.isInteger(b.axis) && b.axis >= 0 && b.axis < 128
    && [b.min,b.center,b.max,b.deadzone].every(Number.isFinite)
    && b.min >= -1 && b.max <= 1 && b.center > b.min && b.center < b.max
    && b.deadzone >= 0 && b.deadzone <= .3 && typeof b.reversed === 'boolean';
}
export function parseProfile(raw: string | null): ControllerProfile {
  try {
    const data: unknown = JSON.parse(raw ?? '{}');
    if (!data || typeof data !== 'object') return {};
    return Object.fromEntries(flightAxes.flatMap(axis => {
      const binding = (data as ControllerProfile)[axis];
      return validBinding(binding) ? [[axis, binding]] : [];
    }));
  } catch { return {}; }
}
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
/** Throttle uses full travel, independent of where its non-centering lever rests. */
export function normalizeAxis(raw: number, binding: AxisBinding, throttle = false): number {
  if (!Number.isFinite(raw) || !validBinding(binding)) throw new Error('Invalid controller axis');
  if (throttle) {
    const value = clamp((raw - binding.min) / (binding.max - binding.min), 0, 1);
    return binding.reversed ? 1 - value : value;
  }
  const offset = raw - binding.center;
  const value = clamp(offset / (offset >= 0 ? binding.max - binding.center : binding.center - binding.min), -1, 1);
  const magnitude = Math.max(0, (Math.abs(value) - binding.deadzone) / (1 - binding.deadzone));
  return Math.sign(value) * magnitude * (binding.reversed ? -1 : 1);
}
/** Device IDs, rather than transient array indices, allow reconnecting and separate HOTAS units.
 * Identical IDs are deliberately ambiguous; never silently choose the wrong device.
 */
export function readController(profile: ControllerProfile, devices: readonly ControllerDevice[]) {
  const values: Partial<Record<FlightAxis, number>> = {};
  for (const axis of flightAxes) {
    const binding = profile[axis];
    if (!binding) continue;
    const matches = devices.filter(d => d.connected && d.id === binding.device);
    const raw = matches[0]?.axes[binding.axis];
    if (matches.length !== 1 || !Number.isFinite(raw) || !validBinding(binding)) return undefined;
    values[axis] = normalizeAxis(raw, binding, axis === 'throttle');
  }
  return profile.pitch && profile.bank ? values : undefined;
}
