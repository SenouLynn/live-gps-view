import type { JSBSimSdk } from '@0x62/jsbsim-wasm';
import type { FlightEngine } from './flightSimulation.ts';
import type { SandboxState } from './sandboxFlight.ts';

const feetToMeters = .3048;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const wrap = (degrees: number) => (degrees % 360 + 360) % 360;
export interface AircraftControls {
  pitch: number; bank: number; rudder: number; throttle: number; trim: number;
}
export interface AircraftState extends SandboxState {
  courseDeg: number;
  climbDeg: number;
  indicatedAirspeedKt: number;
  trueAirspeedMps: number;
  groundSpeedMps: number;
  verticalSpeedMps: number;
  throttle: number;
}
export interface AircraftEngine extends FlightEngine<AircraftState, AircraftControls, SandboxState> {
  destroy(): void;
}

/** JSBSim's geodetic output uses its default WGS84 ellipsoid, not MSL/geoid height.
 * Keep native feet, body controls and local NED velocity behind this adapter.
 */
export function createJsbsimEngine(sdk: JSBSimSdk, initial: SandboxState): AircraftEngine {
  const get = (name: string) => sdk.getPropertyValue(name);
  const set = (name: string, value: number) => sdk.setPropertyValue(name, value);
  let trim = 0, trimAileron = 0, trimRudder = 0, destroyed = false;
  function snapshot(): AircraftState {
    const north = get('velocities/v-north-fps'), east = get('velocities/v-east-fps');
    const down = get('velocities/v-down-fps');
    const groundSpeedFps = Math.hypot(north, east);
    const result: AircraftState = {
      latitudeDeg: get('position/lat-geod-deg'), longitudeDeg: ((get('position/long-gc-deg') + 540) % 360) - 180,
      ellipsoidHeightM: get('position/geod-alt-ft') * feetToMeters,
      headingDeg: wrap(get('attitude/psi-deg')), pitchDeg: get('attitude/theta-deg'), rollDeg: get('attitude/phi-deg'),
      timeSeconds: sdk.getSimTime(), commandPitchDeg: 0, commandBankDeg: 0,
      courseDeg: groundSpeedFps > .01 ? wrap(Math.atan2(east, north) * 180 / Math.PI) : wrap(get('attitude/psi-deg')),
      climbDeg: Math.atan2(-down, groundSpeedFps) * 180 / Math.PI,
      indicatedAirspeedKt: get('velocities/vc-kts'), trueAirspeedMps: get('velocities/vtrue-fps') * feetToMeters,
      groundSpeedMps: groundSpeedFps * feetToMeters, verticalSpeedMps: -down * feetToMeters,
      throttle: get('fcs/throttle-cmd-norm'),
    };
    if (!Object.values(result).every(Number.isFinite) || Math.abs(result.latitudeDeg) > 90)
      throw new Error('Flight dynamics returned an invalid aircraft state. Reset flight to recover.');
    return result;
  }
  function reset(state: SandboxState) {
    if (destroyed) throw new Error('Flight engine has been disposed.');
    sdk.resetToInitialConditions(2); // caller reapplies controls before RunIC
    sdk.setDt(1 / 120);
    const properties = {
      'ic/lat-geod-deg': state.latitudeDeg, 'ic/long-gc-deg': state.longitudeDeg,
      'ic/h-sl-ft': state.ellipsoidHeightM / feetToMeters, 'ic/psi-true-deg': state.headingDeg,
      'ic/vc-kts': 100, 'ic/gamma-deg': 0, 'ic/phi-deg': 0, 'ic/theta-deg': 0,
      'ic/p-rad_sec': 0, 'ic/q-rad_sec': 0, 'ic/r-rad_sec': 0,
      // Ground operations are deferred; do not collide with an unrelated flat plane.
      'ic/terrain-elevation-ft': -100000,
      'fcs/throttle-cmd-norm': .7, 'fcs/mixture-cmd-norm': 1,
      'fcs/elevator-cmd-norm': 0, 'fcs/aileron-cmd-norm': 0, 'fcs/rudder-cmd-norm': 0,
      'fcs/pitch-trim-cmd-norm': 0, 'fcs/roll-trim-cmd-norm': 0, 'fcs/yaw-trim-cmd-norm': 0,
      'propulsion/magneto_cmd': 3, 'propulsion/set-running': -1,
    };
    for (const [name, value] of Object.entries(properties)) set(name, value);
    if (!sdk.runIc()) throw new Error('Unable to initialize the C172.');
    // h-sl is radial altitude, slightly different from geodetic ellipsoid height.
    // Correct the initial value using the engine's own geodetic output.
    set('ic/h-sl-ft', get('ic/h-sl-ft') + (state.ellipsoidHeightM - snapshot().ellipsoidHeightM) / feetToMeters);
    if (!sdk.runIc()) throw new Error('Unable to initialize the C172 altitude.');
    sdk.doTrim(1); // full trim also balances propeller torque in roll/yaw
    sdk.setSimTime(0);
    trim = get('fcs/pitch-trim-cmd-norm');
    trimAileron = get('fcs/aileron-cmd-norm');
    trimRudder = get('fcs/rudder-cmd-norm');
    const initialized = snapshot();
    if (Math.abs(initialized.ellipsoidHeightM - state.ellipsoidHeightM) > .1 || Math.abs(initialized.verticalSpeedMps) > .5)
      throw new Error('The C172 could not establish trimmed level flight.');
  }
  try { reset(initial); } catch (error) { sdk.destroy(); throw error; }
  return {
    reset, snapshot,
    advance(input, dtSeconds) {
      if (destroyed) throw new Error('Flight engine has been disposed.');
      if (![...Object.values(input), dtSeconds].every(Number.isFinite) || dtSeconds <= 0 || dtSeconds > .1)
        throw new Error('Invalid flight controls or timestep.');
      sdk.setDt(dtSeconds);
      // Positive app pitch raises the nose; JSBSim positive elevator lowers it.
      set('fcs/elevator-cmd-norm', -.25 * clamp(input.pitch, -1, 1));
      set('fcs/aileron-cmd-norm', clamp(trimAileron + .3 * clamp(input.bank, -1, 1), -1, 1));
      set('fcs/rudder-cmd-norm', clamp(trimRudder + .3 * clamp(input.rudder, -1, 1), -1, 1));
      set('fcs/throttle-cmd-norm', clamp(input.throttle, 0, 1));
      set('fcs/pitch-trim-cmd-norm', clamp(trim - input.trim, -1, 1));
      if (!sdk.run()) throw new Error('Flight dynamics stopped. Reset flight to recover.');
    },
    destroy() { if (!destroyed) { destroyed = true; sdk.destroy(); } },
  };
}

/** One-step delayed rendering; no engine execution or extrapolation while drawing. */
export function interpolateAircraft(a: AircraftState, b: AircraftState, fraction: number): AircraftState {
  const t = clamp(fraction, 0, 1);
  const result = { ...b };
  for (const key of Object.keys(b) as (keyof AircraftState)[]) result[key] = a[key] + (b[key] - a[key]) * t;
  const angle = (x: number, y: number) => x + (((y - x + 540) % 360) - 180) * t;
  result.headingDeg = wrap(angle(a.headingDeg, b.headingDeg));
  result.courseDeg = wrap(angle(a.courseDeg, b.courseDeg));
  result.rollDeg = angle(a.rollDeg, b.rollDeg);
  result.longitudeDeg = ((angle(a.longitudeDeg, b.longitudeDeg) + 540) % 360) - 180;
  return result;
}
