import * as C from 'cesium';
import { sampleRoute, durationSeconds } from './pose.ts';
import { aircraftFrame, type FollowPose } from './followCamera.ts';

/** Resolved replay-time data. A future adapter supplies measured motion and optional
 * timestamped setpoints; missing/stale commands must never become inferred intent. */
export interface DirectorSample {
  timeSeconds: number;
  motion: { courseDeg: number; climbDeg: number };
  attitude: { yawDeg: number; pitchDeg: number; rollDeg: number };
  command?: { timeSeconds: number; headingDeg: number; pitchDeg: number; provenance: 'synthetic' | 'recorded' | 'live' };
}
export function sampleDemoDirector(seconds: number): DirectorSample {
  const timeSeconds = Math.max(0, Math.min(durationSeconds, seconds));
  const actual = sampleRoute(timeSeconds, 0);
  const lead = sampleRoute(timeSeconds + 2, 0);
  return {
    timeSeconds,
    motion: { courseDeg: actual.headingDeg, climbDeg: actual.pitchDeg },
    // Small synthetic sideslip separates nose direction from course.
    attitude: { yawDeg: (actual.headingDeg + 2 * Math.sin(timeSeconds * Math.PI / 30) + 360) % 360,
      pitchDeg: actual.pitchDeg, rollDeg: actual.rollDeg },
    command: { timeSeconds, headingDeg: lead.headingDeg, pitchDeg: lead.pitchDeg, provenance: 'synthetic' },
  };
}

/** Camera lag is sampled on replay time: pause/seek/restart remain deterministic. */
export function demoDirectorCamera(seconds: number, position: C.Cartesian3): FollowPose {
  const past = sampleDemoDirector(seconds - .35);
  return { position, courseDeg: past.motion.courseDeg, yawDeg: past.attitude.yawDeg,
    pitchDeg: past.attitude.pitchDeg * .7, rollDeg: past.attitude.rollDeg * .3 };
}

/** Commands older than this are stale and must not be drawn. */
const COMMAND_MAX_AGE_S = .5;
const EDGE_INSET = 28;
const CAPTURE_PX = 9;

const wrap180 = (deg: number) => ((deg + 540) % 360) - 180;
const signed = (deg: number) => `${deg < 0 ? '−' : '+'}${Math.abs(deg).toFixed(1)}°`;
const bearing = (deg: number) => `${Math.round((deg + 360) % 360).toString().padStart(3, '0')}°`;

export function currentCommand(sample: DirectorSample) {
  const intent = sample.command;
  return intent && Math.abs(sample.timeSeconds - intent.timeSeconds) <= COMMAND_MAX_AGE_S ? intent : undefined;
}

/** Steering error from the measured flight path to the command, in degrees. */
export function steeringError(sample: DirectorSample) {
  const intent = currentCommand(sample);
  if (!intent) return undefined;
  return { rightDeg: wrap180(intent.headingDeg - sample.motion.courseDeg), upDeg: intent.pitchDeg - sample.motion.climbDeg };
}

export function formatSteer(error: { rightDeg: number; upDeg: number }) {
  const lateral = Math.abs(error.rightDeg) < .05 ? '0.0°' : `${error.rightDeg > 0 ? 'R' : 'L'} ${Math.abs(error.rightDeg).toFixed(1)}°`;
  const vertical = Math.abs(error.upDeg) < .05 ? '0.0°' : `${error.upDeg > 0 ? 'up' : 'down'} ${Math.abs(error.upDeg).toFixed(1)}°`;
  return `${lateral} · ${vertical}`;
}

type Placement = { x: number; y: number; edge: boolean; angleDeg: number };

export function setupDirectorOverlay(viewer: C.Viewer) {
  const el = (id: string) => document.getElementById(id)!;
  const overlay = el('director-overlay');
  const reticle = el('reticle');
  const sidebar = el('sidebar');
  const hud = el('hud');
  const readout = el('director-readout');
  const replayBar = el('replay-bar');
  const path = el('fd-path');
  const command = el('fd-command');
  const steer = el('fd-steer');
  const pathRead = el('fd-path-read');
  const commandRead = el('fd-command-read');
  const commandLabel = el('fd-command-label');
  const steerRead = el('fd-steer-read');
  let current: { pose: FollowPose; sample: DirectorSample } | undefined;
  let lastText = -Infinity;
  const scratch = { offset: new C.Cartesian3(1500, 0, 0), target: new C.Cartesian3(), delta: new C.Cartesian3() };

  /** Viewport area not covered by the panels, so cues never hide under them. */
  function safeArea() {
    const canvas = viewer.scene.canvas;
    const area = { left: 0, top: 0, right: canvas.clientWidth, bottom: canvas.clientHeight };
    const side = sidebar.getBoundingClientRect();
    if (side.height > area.bottom * .6 && side.right < area.right * .6) area.left = side.right;
    else if (side.top > area.bottom * .3) area.bottom = side.top;
    area.top = hud.getBoundingClientRect().bottom;
    if (!replayBar.hidden) area.bottom = Math.min(area.bottom, replayBar.getBoundingClientRect().top);
    return area;
  }

  function place(heading: number, pitch: number, area: ReturnType<typeof safeArea>): Placement {
    const camera = viewer.camera;
    const frame = aircraftFrame({ ...current!.pose, yawDeg: heading, pitchDeg: pitch, rollDeg: 0 });
    const target = C.Matrix4.multiplyByPoint(frame, scratch.offset, scratch.target);
    const delta = C.Cartesian3.subtract(target, camera.positionWC, scratch.delta);
    const ahead = C.Cartesian3.dot(delta, camera.directionWC) > 0;
    const screen = ahead ? C.SceneTransforms.worldToWindowCoordinates(viewer.scene, target) : undefined;
    const inner = { left: area.left + EDGE_INSET, top: area.top + EDGE_INSET, right: area.right - EDGE_INSET, bottom: area.bottom - EDGE_INSET };
    if (screen && screen.x >= inner.left && screen.x <= inner.right && screen.y >= inner.top && screen.y <= inner.bottom)
      return { x: screen.x, y: screen.y, edge: false, angleDeg: 0 };
    // Outside the safe area or behind the camera: pin to the edge, pointing the way to turn.
    const cx = (inner.left + inner.right) / 2, cy = (inner.top + inner.bottom) / 2;
    let dx: number, dy: number;
    if (screen) { dx = screen.x - cx; dy = screen.y - cy; }
    else { dx = C.Cartesian3.dot(delta, camera.rightWC); dy = -C.Cartesian3.dot(delta, camera.upWC); }
    if (dx === 0 && dy === 0) dy = 1;
    const scale = Math.min((inner.right - cx) / Math.max(Math.abs(dx), 1e-6), (inner.bottom - cy) / Math.max(Math.abs(dy), 1e-6));
    return { x: cx + dx * scale, y: cy + dy * scale, edge: true, angleDeg: Math.atan2(dy, dx) * 180 / Math.PI };
  }

  function draw(cue: HTMLElement | SVGElement, at: Placement | undefined, horizonDeg: number) {
    cue.toggleAttribute('hidden', !at);
    if (!at) return;
    cue.classList.toggle('is-edge', at.edge);
    cue.setAttribute('transform', `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)}) rotate(${(at.edge ? at.angleDeg : horizonDeg).toFixed(1)})`);
  }

  viewer.scene.postRender.addEventListener(() => {
    if (!current) return;
    const { sample } = current;
    const intent = currentCommand(sample);
    const area = safeArea();
    // Symbols roll with the rendered horizon, not with the aircraft.
    const horizonDeg = -C.Math.toDegrees(viewer.camera.roll);
    const pathAt = place(sample.motion.courseDeg, sample.motion.climbDeg, area);
    const commandAt = intent ? place(intent.headingDeg, intent.pitchDeg, area) : undefined;
    draw(path, pathAt, horizonDeg);
    draw(command, commandAt, horizonDeg);
    const gap = commandAt ? Math.hypot(commandAt.x - pathAt.x, commandAt.y - pathAt.y) : 0;
    command.classList.toggle('is-captured', !!commandAt && !commandAt.edge && !pathAt.edge && gap <= CAPTURE_PX);
    const showSteer = !!commandAt && !pathAt.edge && gap > 24;
    steer.toggleAttribute('hidden', !showSteer);
    if (showSteer) {
      // Stop the line at the ring and bird outlines instead of crossing them.
      const ux = (commandAt.x - pathAt.x) / gap, uy = (commandAt.y - pathAt.y) / gap;
      const end = commandAt.edge ? 10 : 24;
      steer.setAttribute('x1', (pathAt.x + ux * 8).toFixed(1)); steer.setAttribute('y1', (pathAt.y + uy * 8).toFixed(1));
      steer.setAttribute('x2', (commandAt.x - ux * end).toFixed(1)); steer.setAttribute('y2', (commandAt.y - uy * end).toFixed(1));
    }
    const now = performance.now();
    if (now - lastText < 100) return;
    lastText = now;
    pathRead.textContent = `${bearing(sample.motion.courseDeg)} ${signed(sample.motion.climbDeg)}`;
    commandRead.textContent = intent ? `${bearing(intent.headingDeg)} ${signed(intent.pitchDeg)}` : 'none current';
    commandLabel.textContent = intent ? `Command · ${intent.provenance}` : 'Command';
    commandRead.parentElement!.classList.toggle('is-absent', !intent);
    const error = steeringError(sample);
    steerRead.textContent = error ? formatSteer(error) : '—';
    steerRead.parentElement!.classList.toggle('is-absent', !error);
  });
  return {
    hide() { current = undefined; overlay.hidden = true; readout.hidden = true; reticle.hidden = false; },
    update(pose: FollowPose, sample: DirectorSample) {
      current = {pose, sample}; overlay.hidden = false; readout.hidden = false; reticle.hidden = true;
    },
  };
}
