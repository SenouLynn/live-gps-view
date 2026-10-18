import { initialSandboxState, type SandboxState } from './sandboxFlight.ts';
import { workflowIds, type Workflow } from './workflows.ts';
export type { Workflow };
export interface ApplicationState {
  version: 1;
  screen: 'setup' | 'workspace';
  workflow: Workflow;
  controls: Record<string, string | boolean>;
  replay: { time: number; playing: boolean };
  sandbox: { mode: 'simple' | 'physics'; start: SandboxState; current: SandboxState; paused: boolean };
}
export const storageKey = 'synthetic-fpv.application.v1';
export function defaultState(): ApplicationState {
  return { version: 1, screen: 'setup', workflow: 'sandbox', controls: {}, replay: { time: 0, playing: true },
    sandbox: { mode: 'simple', start: initialSandboxState(), current: initialSandboxState(), paused: false } };
}
function validPose(value: unknown): value is SandboxState {
  if (!value || typeof value !== 'object') return false;
  const p = value as SandboxState;
  return Object.keys(initialSandboxState()).every(key => Number.isFinite(p[key as keyof SandboxState]))
    && Math.abs(p.latitudeDeg) <= 85 && Math.abs(p.longitudeDeg) <= 180
    && p.ellipsoidHeightM >= 100 && p.ellipsoidHeightM <= 4000 && p.timeSeconds >= 0;
}
export function decodeState(raw: string | null): ApplicationState {
  const fallback = defaultState();
  try {
    const saved = JSON.parse(raw ?? 'null');
    if (saved?.version !== 1 || !workflowIds.includes(saved.workflow)) return fallback;
    fallback.workflow = saved.workflow;
    fallback.screen = saved.screen === 'workspace' ? 'workspace' : 'setup';
    if (saved.controls && typeof saved.controls === 'object') {
      for (const [key, value] of Object.entries(saved.controls)) {
        if (typeof value === 'string' || typeof value === 'boolean') fallback.controls[key] = value;
      }
    }
    if (Number.isFinite(saved.replay?.time) && typeof saved.replay?.playing === 'boolean')
      fallback.replay = { time: Math.max(0, Math.min(120, saved.replay.time)), playing: saved.replay.playing };
    if (saved.sandbox?.mode === 'physics') fallback.sandbox.mode = 'physics';
    if (validPose(saved.sandbox?.start)) fallback.sandbox.start = saved.sandbox.start;
    if (validPose(saved.sandbox?.current)) fallback.sandbox.current = saved.sandbox.current;
    if (typeof saved.sandbox?.paused === 'boolean') fallback.sandbox.paused = saved.sandbox.paused;
    return fallback;
  } catch { return fallback; }
}
export let persistenceAvailable = true;
function read() { try { return localStorage.getItem(storageKey); } catch { persistenceAvailable = false; return null; } }
export const application = decodeState(read());
export function saveApplication() {
  try { localStorage.setItem(storageKey, JSON.stringify(application)); }
  catch { persistenceAvailable = false; }
  const note = document.getElementById('session-storage');
  if (note) note.textContent = !persistenceAvailable ? 'Browser storage unavailable · this session cannot survive reload'
    : application.workflow === 'sandbox' && application.sandbox.mode === 'physics'
      ? 'Settings saved · Physics Engine reload starts a new trimmed flight'
      : 'Session saved in this browser · reload to resume';
}
