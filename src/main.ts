import * as C from 'cesium';
import { populateReplayScenarios, setupReplayScenarios } from './replayScenarios.ts';
import { controlAvailability } from './controlAvailability';
import { application, saveApplication } from './applicationState';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import { setupGnssScene } from './gnssScene';
import { setupGnss } from './gnssView';
import { setupHangar } from './hangar';
import { setupCameraControls } from './cameraControls';
import { setupFollowCamera } from './followCamera';
import { setupSandbox } from './sandbox';
import { sampleDemoDirector, demoDirectorCamera, setupDirectorOverlay } from './flightDirector';
import { setupLocationHover } from './locationHover';
import { setupAirspace } from './layers/airspace';
import { setupWeather } from './layers/weather';
import { setupTraffic } from './traffic';
import { setupLive } from './live';
import { setupSceneSource } from './scene';
import { durationSeconds, sampleRoute } from './pose';
import { terrainStepSeconds, terrainHeightAt, resolveHeight } from './altitude';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
populateReplayScenarios();
// Restore controls before feature modules install their handlers.
el<HTMLSelectElement>('telemetry-source').value = application.workflow;
for (const id of ['altitude-mode', 'altitude', 'pitch']) {
  const label = el(id).closest('label');
  if (label) label.hidden = application.workflow !== 'demo';
}
const persistedControls = ['validation-scenario', 'location-hover', 'replay-view', 'camera-behavior', 'follow-distance', 'follow-elevation', 'scene-source', 'quality', 'altitude-mode', 'altitude', 'pitch', 'fov', 'speed', 'traffic-enabled', 'aircraft-models', 'wind-enabled', 'radar-enabled', 'airspace-ceilings', 'airspace-restrictions', 'airspace-sites', 'airspace-labels', 'airspace-opacity'];
for (const id of persistedControls) {
  const control = el<HTMLInputElement | HTMLSelectElement>(id);
  const value = application.controls[id];
  if (control instanceof HTMLInputElement && control.type === 'checkbox') {
    if (typeof value === 'boolean') control.checked = value;
  } else if (typeof value === 'string') {
    if (control instanceof HTMLSelectElement) {
      if (Array.from(control.options).some(option => option.value === value)) control.value = value;
    } else if (Number.isFinite(Number(value)) && Number(value) >= Number(control.min) && Number(value) <= Number(control.max)) control.value = value;
  }
}
// Explicit providers avoid hidden ion credentials or dependencies on default services.
const viewer = new C.Viewer('globe', {
  baseLayer: false, terrainProvider: new C.EllipsoidTerrainProvider(),
  animation: false, timeline: false, baseLayerPicker: false, geocoder: false,
  homeButton: false, sceneModePicker: false, navigationHelpButton: false,
  fullscreenButton: false, selectionIndicator: false, infoBox: false,
});
el('sidebar-toggle').onclick = () => {
  const collapsed = el('sidebar').classList.toggle('collapsed');
  el('sidebar-toggle').textContent = collapsed ? 'Show controls' : 'Hide';
  el('sidebar-toggle').setAttribute('aria-expanded', String(!collapsed));
};
// Publish where the HUD ends and the sidebar sheet begins; both change height at runtime.
function syncInsets() {
  const root = document.documentElement.style;
  root.setProperty('--hud-bottom', `${el('hud').getBoundingClientRect().bottom}px`);
  root.setProperty('--sheet-top', `${el('sidebar').getBoundingClientRect().top}px`);
}
const insets = new ResizeObserver(syncInsets);
insets.observe(el('hud'));
insets.observe(el('sidebar'));
addEventListener('resize', syncInsets);
viewer.scene.screenSpaceCameraController.enableInputs = false;
viewer.scene.globe.baseColor = C.Color.fromCssColorString('#253942');
viewer.scene.globe.enableLighting = false;
viewer.scene.fog.enabled = true;
viewer.scene.globe.maximumScreenSpaceError = 2;
let imageryFailed = false;
let imageryInfo = 'Imagery metadata loading';
let imageryStarted = false;
async function loadImagery() {
  if (imageryStarted) return;
  imageryStarted = true;
  try {
    const provider = await C.ArcGisMapServerImageryProvider.fromUrl(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
      { enablePickFeatures: false },
    );
    viewer.imageryLayers.addImageryProvider(provider);
    imageryInfo = `Imagery max zoom ${provider.maximumLevel ?? 'provider-defined'}`;
    provider.errorEvent.addEventListener(() => {
      imageryFailed = true;
      imageryInfo = 'Imagery tiles incomplete';
      el('environment').textContent = 'Imagery unavailable or incomplete · check network';
    });
  } catch {
    imageryFailed = true;
    imageryInfo = 'Imagery unavailable';
    el('environment').textContent = 'Imagery metadata unavailable · check network and reload';
  }
}
const sceneSource = setupSceneSource(viewer, () => { void loadImagery(); });
// Lower screen-space error asks for finer source tiles; it cannot increase source resolution.
const qualityPresets = {
  smooth: { error: 3, cache: 250, scale: 1, native: false, siblings: true },
  balanced: { error: 2, cache: 100, scale: 1, native: false, siblings: false },
  high: { error: 1, cache: 250, scale: 1, native: true, siblings: true },
  ultra: { error: 0.5, cache: 400, scale: 1.25, native: true, siblings: true },
};
let adaptiveScale = 1, qualityWarmupUntil = 0;
function applyQuality() {
  const name = el<HTMLSelectElement>('quality').value as keyof typeof qualityPresets;
  const preset = qualityPresets[name];
  viewer.scene.globe.maximumScreenSpaceError = preset.error;
  viewer.scene.globe.tileCacheSize = preset.cache;
  viewer.scene.globe.preloadSiblings = preset.siblings;
  viewer.useBrowserRecommendedResolution = !preset.native;
  adaptiveScale = preset.scale;
  viewer.resolutionScale = adaptiveScale;
  qualityWarmupUntil = performance.now() + 3000;
  viewer.scene.msaaSamples = name === 'smooth' ? 1 : 4;
  viewer.scene.postProcessStages.fxaa.enabled = name === 'smooth';
  sceneSource.setDetail(name);
  // Fog can relax refinement in the distance; keep its appearance without relaxing detail.
  viewer.scene.fog.screenSpaceErrorFactor = name === 'balanced' || name === 'smooth' ? 2 : 0;
}
el('quality').onchange = applyQuality;
applyQuality();
let frameCount = 0, fpsStarted = performance.now(), fps = 0;
let pendingTiles = 0;
viewer.scene.globe.tileLoadProgressEvent.addEventListener((count: number) => { pendingTiles = count; });
let terrainHeights: number[] = [];
let terrainLoading = false;
let terrainStatus = 'Preparing terrain profile…';
async function loadTerrain() {
  if (terrainLoading) return;
  terrainLoading = true;
  el('retry-terrain').hidden = true;
  terrainStatus = 'Loading terrain profile · AGL playback waits';
  el('environment').textContent = terrainStatus;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Pre-sample this short route so playback and seeks do not depend on visible tile LOD.
    const result = await Promise.race([
      (async () => {
        const provider = await C.CesiumTerrainProvider.fromUrl('https://terrain.reearth.land/cesium-mesh/ellipsoid', {
          credit: 'Terrain: Re:Earth / Mapterhorn · CC BY 4.0',
        });
        const positions = Array.from({ length: durationSeconds / terrainStepSeconds + 1 }, (_, i) => {
          const point = sampleRoute(i * terrainStepSeconds, 0);
          return C.Cartographic.fromDegrees(point.longitudeDeg, point.latitudeDeg);
        });
        const samples = await C.sampleTerrainMostDetailed(provider, positions, true);
        const heights = samples.map(point => point.height);
        if (!heights.every(Number.isFinite)) throw new Error('Incomplete terrain profile');
        return { provider, heights };
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Terrain request timed out')), 30000); }),
    ]);
    terrainHeights = result.heights;
    viewer.terrainProvider = result.provider;
    result.provider.errorEvent.addEventListener(() => {
      el('environment').textContent = 'Terrain display tiles incomplete · AGL uses sampled profile';
    });
    terrainStatus = 'Terrain profile ready';
    if (!imageryFailed) el('environment').textContent = 'Real terrain + aerial imagery · sampled AGL ready';
  } catch {
    terrainStatus = 'Terrain unavailable · retry or select ellipsoid mode';
    el('environment').textContent = terrainStatus;
    el('retry-terrain').hidden = false;
  } finally {
    clearTimeout(timer);
    terrainLoading = false;
  }
}
el('retry-terrain').onclick = () => { void loadTerrain(); };
const start = sampleRoute(0, 450);
viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(start.longitudeDeg, start.latitudeDeg, 450),
  orientation: { heading: C.Math.toRadians(start.headingDeg), pitch: C.Math.toRadians(-8), roll: 0 } });
void loadTerrain();
const cameraControls = setupCameraControls(viewer);
const followCamera = setupFollowCamera(viewer, cameraControls.orbit, cameraControls.followReference);
const directorOverlay = setupDirectorOverlay(viewer);
const hangar = setupHangar();
const sandbox = setupSandbox(viewer, followCamera, directorOverlay, course => weather.setCourse(course), cameraControls, hangar);
const replayView = el<HTMLSelectElement>('replay-view');
for (const [id, suffix] of [['follow-distance', ' m'], ['follow-elevation', '°']]) {
  input(id).oninput = () => { el(`${id}-label`).textContent = input(id).value + suffix; };
}
const live = setupLive(viewer, cameraControls);
const traffic = setupTraffic(viewer, cameraControls);
const weather = setupWeather(viewer);
setupGnss(viewer);
const gnssScene=setupGnssScene(viewer);
const airspace = setupAirspace(viewer, () => { void openWorkspaceLocation(true); });
setupLocationHover(viewer, input('location-hover'), airspace.hoverDetail);
async function openWorkspaceLocation(inspect = false) {
  try {
    const { openLocationPicker } = await import('./locationPicker');
    const position = viewer.camera.positionCartographic;
    const current = sandbox.currentPose();
    const initial = !inspect && application.workflow === 'sandbox' ? { lat: current.latitudeDeg, lon: current.longitudeDeg }
      : { lat: Math.max(-85,Math.min(85,C.Math.toDegrees(position.latitude))), lon: C.Math.toDegrees(position.longitude) };
    await openLocationPicker({ initial, airspace: inspect, action: application.workflow === 'sandbox' ? 'Start Sandbox here' : 'Save Sandbox starting point',
      onSelect(point) {
        application.sandbox.start = { ...application.sandbox.start, latitudeDeg:point.lat, longitudeDeg:point.lon, timeSeconds:0, pitchDeg:0, rollDeg:0, commandPitchDeg:0, commandBankDeg:0 };
        application.sandbox.current = { ...application.sandbox.start };
        sandbox.relocate(); saveApplication();
        if (application.workflow === 'sandbox') airspace.refresh(point);
        else el('environment').textContent = 'Starting point saved for your next Sandbox flight';
      } });
  } catch { el('environment').textContent = 'Location picker unavailable · use Workspace setup to enter coordinates'; }
}
el('location-open').onclick = () => { void openWorkspaceLocation(); };
let preferredView = replayView.value;
function syncControlAvailability() {
  const source = el<HTMLSelectElement>('telemetry-source').value;
  const overview = gnssScene.overview();
  const trafficFollow = !!el<HTMLSelectElement>('traffic-follow').value;
  const fixedCockpit = source === 'live' || trafficFollow;
  if (fixedCockpit) replayView.value = 'cockpit';
  else replayView.value = preferredView;
  for (const option of Array.from(replayView.options)) option.disabled = fixedCockpit && option.value !== 'cockpit';
  const reasons = controlAvailability({ source, physicsReplay: el<HTMLSelectElement>('validation-scenario').value !== 'figure-eight', view: replayView.value, overview, overviewKind: 'orbit', trafficFollow,
    traffic: input('traffic-enabled').checked, satellites: input('gnss-3d').checked,
    radar: input('radar-enabled').checked, vehicles: el<HTMLSelectElement>('vehicle').options.length > 0,
    livePose: live.hasPose() });
  for (const [id, reason] of Object.entries(reasons)) {
    const control = el<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(id);
    control.disabled = !!reason;
    control.title = reason;
    const label = control.closest('label');
    if (label) { label.title = reason; label.classList.toggle('control-unavailable', !!reason); }
  }
  el('follow-controls').hidden = replayView.value === 'cockpit';
  el('cockpit-pitch').hidden = source !== 'demo' || replayView.value !== 'cockpit';
  el('sandbox-controls').hidden = source !== 'sandbox';
  el('reticle').hidden = overview || (source === 'live' && !trafficFollow && !live.hasPose());
  const message = overview ? 'Orbit overview · flight controls suspended'
    : trafficFollow ? 'Aircraft cockpit · own vehicle controls suspended'
    : source === 'live' ? 'Live telemetry controls the aircraft pose and cockpit view'
    : source === 'sandbox' ? 'Sandbox controls the aircraft pose · replay controls unavailable'
    : replayView.value === 'cockpit' ? 'Replay cockpit · follow controls unavailable' : 'Replay follow view · cockpit pitch unavailable';
  el('control-context').textContent = message;
  const zonesOn = input('airspace-ceilings').checked || input('airspace-restrictions').checked || input('airspace-sites').checked;
  for (const id of ['airspace-labels', 'airspace-opacity', 'airspace-refresh']) {
    const control = el<HTMLInputElement | HTMLButtonElement>(id);
    control.disabled = !zonesOn; control.title = zonesOn ? '' : 'Enable an airspace layer first.';
  }
}
replayView.addEventListener('change', () => { if (!replayView.disabled) preferredView = replayView.value; });
document.addEventListener('change', syncControlAvailability);
document.addEventListener('click', syncControlAvailability);
syncControlAvailability();

let time = application.replay.time, playing = application.replay.playing, previous = performance.now(), lastHud = -Infinity;
const validation = setupReplayScenarios(viewer, followCamera, directorOverlay, cameraControls, course=>weather.setCourse(course), () => { time=0; playing=true; syncPlay(); });
const formatTime = (value: number) => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
function syncPlay() {
  el('play').dataset.state = playing ? 'playing' : 'paused';
  el('play').setAttribute('aria-label', playing ? 'Pause replay' : 'Play replay');
}
/** The replay bar belongs to demo telemetry only; other sources own their own status. */
function syncReplayBar() {
  const shown = el<HTMLSelectElement>('telemetry-source').value === 'demo'
    && !el<HTMLSelectElement>('traffic-follow').value && !gnssScene.overview();
  validation.setVisible(shown);
  input('seek').max = String(validation.duration);
  if (el('replay-bar').hidden === shown) { el('replay-bar').hidden = !shown; syncInsets(); }
  if (el('time').hidden !== shown) el('time').hidden = shown;
}
el('play').onclick = () => { if (time >= validation.duration) time = 0; playing = !playing; syncPlay(); };
el('restart').onclick = () => { validation.restart(); time = 0; playing = true; syncPlay(); };
input('seek').oninput = () => { time = Number(input('seek').value); };
for (const [id, suffix] of [['altitude', ' m'], ['pitch', '°'], ['fov', '°']]) {
  input(id).oninput = () => { el(id === 'altitude' ? 'alt-label' : `${id}-label`).textContent = input(id).value + suffix; };
}
viewer.scene.preUpdate.addEventListener(() => {
  const now = performance.now();
  frameCount++;
  if (now - fpsStarted >= 1000) {
    fps = frameCount * 1000 / (now - fpsStarted);
    if (el<HTMLSelectElement>('quality').value === 'smooth' && now > qualityWarmupUntil && !document.hidden) {
      // Hysteresis avoids oscillation; change only once per measurement window.
      const next = fps < 52 ? Math.max(.65, adaptiveScale - .1)
        : fps > 58 ? Math.min(1, adaptiveScale + .05) : adaptiveScale;
      if (Math.abs(next - adaptiveScale) > .001) {
        adaptiveScale = next;
        viewer.resolutionScale = adaptiveScale;
        qualityWarmupUntil = now + 2000;
      }
    }
    frameCount = 0;
    fpsStarted = now;
  }
  const dt = Math.min((now - previous) / 1000, 0.25); previous = now;
  directorOverlay.hide();
  syncReplayBar();
  syncControlAvailability();
  const sandboxSelected = el<HTMLSelectElement>('telemetry-source').value === 'sandbox'
    && !el<HTMLSelectElement>('traffic-follow').value && !gnssScene.overview();
  if (!sandboxSelected) sandbox.suspend();
  const source = el<HTMLSelectElement>('telemetry-source').value;
  const trafficId = el<HTMLSelectElement>('traffic-follow').value;
  const cameraAvailable = !gnssScene.overview() && !(source === 'live' && !trafficId && !live.hasPose());
  const cameraMode = cameraAvailable ? replayView.value === 'cockpit' ? 'cockpit' : 'follow' : 'disabled';
  cameraControls.step(dt, cameraMode, `${source}/${replayView.value}/${trafficId}/${el<HTMLSelectElement>('vehicle').value}/${cameraAvailable}`);
  if(gnssScene.overview()) {
    followCamera.hide();
    el('detail-status').textContent = `${fps.toFixed(0)} FPS · GNSS orbit overview · drag to orbit, scroll to zoom`;
    return;
  }
  const frustum = viewer.camera.frustum;
  if (frustum instanceof C.PerspectiveFrustum) frustum.fov = C.Math.toRadians(Number(input('fov').value));
  if (traffic.tick()) { followCamera.hide(); weather.setCourse(C.Math.toDegrees(viewer.camera.heading)); return; }
  if (live.active()) {
    followCamera.hide();
    live.tick();
    weather.setCourse(C.Math.toDegrees(viewer.camera.heading));
    if (now - lastHud > 100) {
      lastHud = now;
      el('detail-status').textContent = `${fps.toFixed(0)} FPS · ${sceneSource.getStatus() ?? imageryInfo}`;
    }
    return;
  }
  if (sandboxSelected) { sandbox.tick(dt, now, `${fps.toFixed(0)} FPS · render ${Math.round(adaptiveScale * 100)}%`); return; }
  const mode = el<HTMLSelectElement>('altitude-mode').value;
  const canResolve = validation.physics ? validation.ready : mode === 'ellipsoid' || terrainHeights.length > 0;
  if (playing && canResolve && !document.querySelector('dialog[open]')) time = Math.min(validation.duration, time + dt * Number(el<HTMLSelectElement>('speed').value));
  if (time >= validation.duration && playing) { playing = false; syncPlay(); }
  if (validation.physics) {
    const impact=validation.render(time, `${fps.toFixed(0)} FPS`);
    if (impact!==undefined) { time=impact; playing=false; syncPlay(); }
    el('replay-wait').hidden=true;
    el('replay-elapsed').textContent=formatTime(time);
    el('replay-total').textContent=formatTime(validation.duration);
    input('seek').value=String(time);
    input('seek').setAttribute('aria-valuetext', `${formatTime(time)} of ${formatTime(validation.duration)}`);
    return;
  }
  const pose = sampleRoute(time, Number(input('altitude').value));
  weather.setCourse(pose.headingDeg);
  const groundM = terrainHeightAt(terrainHeights, time);
  const cameraHeight = resolveHeight(mode, pose.ellipsoidHeightM, groundM);
  if (cameraHeight === undefined || replayView.value === 'cockpit') followCamera.hide();
  if (cameraHeight !== undefined && replayView.value !== 'cockpit') {
    const position = C.Cartesian3.fromDegrees(pose.longitudeDeg, pose.latitudeDeg, cameraHeight);
    const director = replayView.value === 'director';
    const sample = sampleDemoDirector(time);
    const aircraftPose = { position, courseDeg: pose.headingDeg,
      yawDeg: director ? sample.attitude.yawDeg : pose.headingDeg, pitchDeg: pose.pitchDeg, rollDeg: pose.rollDeg };
    followCamera.update(aircraftPose, replayView.value === 'stable',
      Number(input('follow-distance').value), Number(input('follow-elevation').value),
      director ? demoDirectorCamera(time, position) : undefined);
    if (director) directorOverlay.update(aircraftPose, sample);
  }
  if (cameraHeight !== undefined && replayView.value === 'cockpit') viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(pose.longitudeDeg, pose.latitudeDeg, cameraHeight),
    orientation: { heading: C.Math.toRadians(pose.headingDeg), pitch: C.Math.toRadians(Number(input('pitch').value)), roll: 0 } });
  if (cameraHeight !== undefined && replayView.value === 'cockpit') cameraControls.cockpit();
  if (now - lastHud > 100) {
    lastHud = now;
    el('detail-status').textContent = `${el<HTMLSelectElement>('quality').selectedOptions[0].text} · ${fps.toFixed(0)} FPS${el<HTMLSelectElement>('quality').value === 'smooth' ? ` · render ${Math.round(adaptiveScale * 100)}%` : ''} · ${sceneSource.getStatus() ?? `${pendingTiles ? pendingTiles + ' terrain/imagery tiles pending' : 'Visible globe tiles loaded'} · ${imageryInfo}`} `;
    el('source-badge').textContent = '● REPLAY';
    el('vehicle-title').textContent = 'DEMO 01 · BURLINGTON, VT';
    el('pose-note').textContent = replayView.value === 'cockpit' ? 'Synthetic figure eight · climb / descent · level horizon' : `Cessna 172 · ${replayView.value === 'stable' ? 'course follow · stable horizon' : replayView.value === 'director' ? 'demo director · synthetic commands' : 'attitude follow'} · synthetic climb / descent`;
    el('telemetry-status').textContent = `Demo replay · synthetic pitch ${pose.pitchDeg.toFixed(1)}° · bank ${pose.rollDeg.toFixed(1)}°`;
    el('alt-reference').textContent = mode === 'agl' ? 'ALT · AGL' : 'ALT · WGS84';
    el('height-detail').textContent = cameraHeight === undefined ? terrainStatus : `Aircraft ${cameraHeight.toFixed(1)} m WGS84 · Ground ${groundM === undefined ? 'unknown' : groundM.toFixed(1) + ' m WGS84'}`;
    el('replay-wait').hidden = canResolve;
    el('alt-read').textContent = `${pose.ellipsoidHeightM.toFixed(0)} m`;
    el('heading').textContent = `${pose.headingDeg.toFixed(0).padStart(3, '0')}°`;
    el('position').textContent = `${pose.latitudeDeg.toFixed(5)}° N / ${Math.abs(pose.longitudeDeg).toFixed(5)}° W`;
    el('replay-elapsed').textContent = formatTime(time);
    el('replay-total').textContent = formatTime(durationSeconds);
    input('seek').value = String(time);
    input('seek').setAttribute('aria-valuetext', `${formatTime(time)} of ${formatTime(durationSeconds)}`);
  }
});
// Avoid advancing replay after a background tab resumes.
document.addEventListener('visibilitychange', () => { previous = performance.now(); fpsStarted = previous; frameCount = 0; qualityWarmupUntil = previous + 3000; });
viewer.scene.renderError.addEventListener(() => {
  playing = false; syncPlay(); el('environment').textContent = 'Rendering failed · reload or check browser WebGL support';
});

syncPlay();
syncControlAvailability();
for (const id of ['follow-distance', 'follow-elevation', 'altitude', 'pitch', 'fov']) input(id).dispatchEvent(new Event('input'));
function checkpoint() {
  application.replay = { time, playing };
  for (const id of persistedControls) {
    const control = el<HTMLInputElement | HTMLSelectElement>(id);
    application.controls[id] = id === 'replay-view' ? preferredView : control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control.value;
  }
  saveApplication();
}
document.addEventListener('change', checkpoint);
document.addEventListener('input', checkpoint);
setInterval(checkpoint, 1000);
window.addEventListener('pagehide', checkpoint);
document.addEventListener('visibilitychange', () => { if (document.hidden) checkpoint(); });
