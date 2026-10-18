import { initialSandboxState } from './sandboxFlight.ts';
import { interpolateAircraft, type AircraftEngine, type AircraftState, type AircraftControls } from './jsbsimEngine.ts';
import { terrainContact } from './terrainContact.ts';

interface ValidationScenarioDefinition {
  id: string;
  group: 'Routes' | 'Feature enhancements';
  name: string;
  expected: string;
  controlsAt?: (seconds: number, initial: AircraftState) => AircraftControls;
}
const neutral = (initial: AircraftState): AircraftControls => ({ pitch: 0, bank: 0, rudder: 0, throttle: initial.throttle, trim: 0 });

/** The domain scenario contract supplies both the UI option and its engine inputs. */
export const validationScenarios = [
  { group: 'Routes', id: 'figure-eight', name: 'Figure eight · flight director', expected: 'Synthetic climb, descent and coordinated turns.' },
  { group: 'Routes', id: 'straight-line', name: 'Straight line · C172 trimmed flight', expected: 'Holds approximately 100 kt and level flight without pilot input.',
    controlsAt: (_seconds, initial) => neutral(initial) },
  { group: 'Feature enhancements', id: 'c172-idle', name: 'C172 · idle power', expected: 'Loses flight energy after power is reduced to idle at 2 seconds.',
    controlsAt: (seconds, initial) => ({ ...neutral(initial), throttle: seconds >= 2 ? 0 : initial.throttle }) },
  { group: 'Feature enhancements', id: 'c172-full-power', name: 'C172 · full power', expected: 'Gains flight energy after full power is applied at 2 seconds.',
    controlsAt: (seconds, initial) => ({ ...neutral(initial), throttle: seconds >= 2 ? 1 : initial.throttle }) },
  { group: 'Feature enhancements', id: 'c172-right-bank', name: 'C172 · right-bank control', expected: 'Right aileron from 2–4 seconds rolls the aircraft right.',
    controlsAt: (seconds, initial) => ({ ...neutral(initial), bank: seconds >= 2 && seconds < 4 ? .5 : 0 }) },
  { group: 'Feature enhancements', id: 'terrain-contact', name: 'Terrain contact · crash and reset', expected: 'Nose-down input at 2 seconds leads to contact, a crash overlay, and Reset flight.',
    controlsAt: (seconds, initial) => ({ ...neutral(initial), pitch: seconds >= 2 ? -1 : 0 }) },
] as const satisfies readonly ValidationScenarioDefinition[];
export type ValidationScenarioId = typeof validationScenarios[number]['id'];
export const validationStart = { ...initialSandboxState(), ellipsoidHeightM: 1100 };
export const validationGroundM = 1000;
export const validationDurationSeconds = 12;
export interface ValidationRecording {
  frames: { seconds: number; aircraft: AircraftState }[];
  impactSeconds?: number;
}

/** Record the real engine at fixed steps so pause, seek and speed are repeatable.
 * The labeled test deck is intentionally independent of online geographic terrain.
 */
export function recordValidation(engine: AircraftEngine, id: Exclude<ValidationScenarioId, 'figure-eight'>): ValidationRecording {
  engine.reset(validationStart);
  let aircraft = engine.snapshot();
  const initial = aircraft;
  const scenario = validationScenarios.find(s => s.id === id);
  if (!scenario || !('controlsAt' in scenario)) throw new Error('Scenario has no aircraft controls.');
  const recording: ValidationRecording = { frames: [{ seconds: 0, aircraft }] };
  for (let step = 1; step <= validationDurationSeconds * 120; step++) {
    const seconds = step / 120;
    if (recording.impactSeconds === undefined) {
      engine.advance(scenario.controlsAt(seconds, initial), 1 / 120);
      aircraft = engine.snapshot();
      const contact = terrainContact(aircraft, validationGroundM);
      if (contact.contactHeightM !== undefined) {
        recording.impactSeconds = seconds;
        aircraft = { ...aircraft, ellipsoidHeightM: contact.contactHeightM };
        recording.frames.push({ seconds, aircraft });
      }
    }
    if (step % 4 === 0) recording.frames.push({ seconds, aircraft });
  }
  return recording;
}
export function sampleValidation(recording: ValidationRecording, seconds: number): AircraftState {
  const frames = recording.frames;
  const t = Math.max(0, Math.min(validationDurationSeconds, seconds));
  let low = 0, high = frames.length - 1;
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].seconds <= t) low = mid; else high = mid;
  }
  const a = frames[low], b = frames[high];
  return interpolateAircraft(a.aircraft, b.aircraft, (t - a.seconds) / (b.seconds - a.seconds || 1));
}
