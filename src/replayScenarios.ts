import * as C from 'cesium';
import { durationSeconds } from './pose.ts';
import { validationScenarios, validationStart, validationGroundM, validationDurationSeconds,
  recordValidation, sampleValidation, type ValidationRecording, type ValidationScenarioId } from './validationScenarios.ts';
import { showCrashOverlay, hideCrashOverlay } from './crashOverlay.ts';
import type { setupFollowCamera } from './followCamera';
import type { setupDirectorOverlay } from './flightDirector';
import type { setupCameraControls } from './cameraControls';
const el = (id: string) => document.getElementById(id)!;
export function populateReplayScenarios() {
  const select = el('validation-scenario') as HTMLSelectElement;
  for (const group of ['Routes', 'Feature enhancements']) {
    const options = document.createElement('optgroup'); options.label = group;
    for (const scenario of validationScenarios.filter(s => s.group === group))
      options.append(new Option(scenario.name, scenario.id));
    select.append(options);
  }
}
export function setupReplayScenarios(viewer: C.Viewer, follow: ReturnType<typeof setupFollowCamera>,
  overlay: ReturnType<typeof setupDirectorOverlay>, camera: ReturnType<typeof setupCameraControls>,
  onCourse: (heading: number) => void, restart: () => void) {
  const select = el('validation-scenario') as HTMLSelectElement;
  let recording: ValidationRecording | undefined, phase: 'idle' | 'loading' | 'ready' | 'failed' = 'idle', epoch = 0;
  let deck: C.Entity | undefined;
  const physics = () => select.value !== 'figure-eight';
  const selected = () => validationScenarios.find(s => s.id === select.value) ?? validationScenarios[0];
  function clear() {
    epoch++; recording = undefined; phase = 'idle'; el('validation-status').dataset.phase=phase; hideCrashOverlay();
    if (deck) viewer.entities.remove(deck); deck = undefined;
  }
  async function load() {
    const generation = epoch;
    phase = 'loading'; el('validation-status').dataset.phase=phase; el('validation-status').textContent = 'Preparing real C172 flight…';
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const { loadAircraftEngine } = await import('./jsbsimLoader.ts');
      const pending = loadAircraftEngine(validationStart);
      void pending.then(engine => { if (generation !== epoch) engine.destroy(); }, () => {});
      const engine = await Promise.race([pending, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Scenario loading timed out')), 30000);
      })]);
      if (generation !== epoch) { engine.destroy(); return; }
      try { recording = recordValidation(engine, select.value as Exclude<ValidationScenarioId, 'figure-eight'>); }
      finally { engine.destroy(); }
      phase = 'ready'; el('validation-status').dataset.phase=phase; el('validation-status').dataset.scenario=select.value;
      deck = viewer.entities.add({ rectangle: {
        coordinates: C.Rectangle.fromDegrees(validationStart.longitudeDeg - .02, validationStart.latitudeDeg - .02,
          validationStart.longitudeDeg + .02, validationStart.latitudeDeg + .02),
        height: validationGroundM, material: C.Color.fromCssColorString('#405354').withAlpha(.9),
        outline: true, outlineColor: C.Color.fromCssColorString('#9fe8c6'),
      }});
      el('validation-status').textContent = selected().expected;
    } catch { if (generation === epoch) { epoch++; phase = 'failed'; el('validation-status').dataset.phase=phase; el('validation-status').textContent = 'Scenario unavailable · Restart to retry.'; } }
    finally { clearTimeout(timer); }
  }
  select.onchange = () => { clear(); restart(); el('validation-status').textContent = selected().expected; };
  el('validation-status').textContent = selected().expected;
  return {
    get physics() { return physics(); },
    get duration() { return physics() ? validationDurationSeconds : durationSeconds; },
    get ready() { return phase === 'ready'; },
    restart() { hideCrashOverlay(); if (phase === 'failed') { clear(); } },
    setVisible(visible: boolean) {
      el('validation-controls').hidden = !visible;
      if (deck) deck.show = visible;
      if (visible && physics() && phase === 'idle') void load();
    },
    render(seconds: number, performanceLabel: string): number | undefined {
      if (!recording) {
        el('telemetry-status').textContent = phase === 'failed' ? 'Validation scenario unavailable' : 'Loading validation scenario';
        el('vehicle-title').textContent = selected().name;
        return;
      }
      const flight = sampleValidation(recording, seconds);
      const position = C.Cartesian3.fromDegrees(flight.longitudeDeg, flight.latitudeDeg, flight.ellipsoidHeightM);
      const pose = { position, courseDeg: flight.courseDeg, yawDeg: flight.headingDeg, pitchDeg: flight.pitchDeg, rollDeg: flight.rollDeg };
      const view = (el('replay-view') as HTMLSelectElement).value;
      if (view === 'cockpit') {
        follow.hide();
        viewer.camera.setView({ destination: position, orientation: { heading: C.Math.toRadians(flight.headingDeg), pitch: C.Math.toRadians(flight.pitchDeg), roll: C.Math.toRadians(flight.rollDeg) } });
        camera.cockpit();
      } else {
        follow.update(pose, view === 'stable', Number((el('follow-distance') as HTMLInputElement).value), Number((el('follow-elevation') as HTMLInputElement).value));
        if (view === 'director') overlay.update(pose, { timeSeconds: seconds, motion: { courseDeg: flight.courseDeg, climbDeg: flight.climbDeg }, attitude: { yawDeg: flight.headingDeg, pitchDeg: flight.pitchDeg, rollDeg: flight.rollDeg } });
      }
      onCourse(flight.courseDeg);
      el('source-badge').textContent = '● VALIDATION'; el('vehicle-title').textContent = selected().name;
      el('telemetry-status').textContent = `C172 · IAS ${flight.indicatedAirspeedKt.toFixed(1)} kt · VS ${Math.round(flight.verticalSpeedMps / .00508)} ft/min`;
      el('pose-note').textContent = `Pitch ${flight.pitchDeg.toFixed(1)}° · bank ${flight.rollDeg.toFixed(1)}° · replay of real JSBSim flight`;
      el('height-detail').textContent = `Flat test surface ${validationGroundM} m WGS84 · clearance ${(flight.ellipsoidHeightM - validationGroundM).toFixed(1)} m`;
      el('alt-reference').textContent = 'ALT · WGS84'; el('alt-read').textContent = `${flight.ellipsoidHeightM.toFixed(0)} m`;
      el('heading').textContent = `${flight.headingDeg.toFixed(0).padStart(3, '0')}°`;
      el('position').textContent = `${flight.latitudeDeg.toFixed(5)}°, ${flight.longitudeDeg.toFixed(5)}°`;
      el('detail-status').textContent = `${performanceLabel} · deterministic physics validation`;
      if (recording.impactSeconds !== undefined && seconds >= recording.impactSeconds) {
        showCrashOverlay(restart);
        return recording.impactSeconds;
      }
    },
  };
}
