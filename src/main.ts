import * as C from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import { setupLive } from './live';
import { setupSceneSource } from './scene';
import { durationSeconds, sampleRoute } from './pose';
import { terrainStepSeconds, terrainHeightAt, resolveHeight } from './altitude';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
// Explicit providers avoid hidden ion credentials or dependencies on default services.
const viewer = new C.Viewer('globe', {
  baseLayer: false, terrainProvider: new C.EllipsoidTerrainProvider(),
  animation: false, timeline: false, baseLayerPicker: false, geocoder: false,
  homeButton: false, sceneModePicker: false, navigationHelpButton: false,
  fullscreenButton: false, selectionIndicator: false, infoBox: false,
});
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
  balanced: { error: 2, cache: 100, scale: 1, native: false, siblings: false },
  high: { error: 1, cache: 250, scale: 1, native: true, siblings: true },
  ultra: { error: 0.5, cache: 400, scale: 1.25, native: true, siblings: true },
};
function applyQuality() {
  const name = el<HTMLSelectElement>('quality').value as keyof typeof qualityPresets;
  const preset = qualityPresets[name];
  viewer.scene.globe.maximumScreenSpaceError = preset.error;
  viewer.scene.globe.tileCacheSize = preset.cache;
  viewer.scene.globe.preloadSiblings = preset.siblings;
  viewer.useBrowserRecommendedResolution = !preset.native;
  viewer.resolutionScale = preset.scale;
  sceneSource.setDetail(name);
  // Fog can relax refinement in the distance; keep its appearance without relaxing detail.
  viewer.scene.fog.screenSpaceErrorFactor = name === 'balanced' ? 2 : 0;
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
const live = setupLive(viewer);
let time = 0, playing = true, previous = performance.now(), lastHud = -Infinity;
const formatTime = (value: number) => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
function syncPlay() { el('play').textContent = playing ? 'Pause' : 'Play'; }
el('play').onclick = () => { if (time >= durationSeconds) time = 0; playing = !playing; syncPlay(); };
el('restart').onclick = () => { time = 0; playing = true; syncPlay(); };
input('seek').oninput = () => { time = Number(input('seek').value); };
for (const [id, suffix] of [['altitude', ' m'], ['pitch', '°'], ['fov', '°']]) {
  input(id).oninput = () => { el(id === 'altitude' ? 'alt-label' : `${id}-label`).textContent = input(id).value + suffix; };
}
viewer.scene.preUpdate.addEventListener(() => {
  const now = performance.now();
  frameCount++;
  if (now - fpsStarted >= 1000) {
    fps = frameCount * 1000 / (now - fpsStarted);
    frameCount = 0;
    fpsStarted = now;
  }
  const dt = Math.min((now - previous) / 1000, 0.25); previous = now;
  const frustum = viewer.camera.frustum;
  if (frustum instanceof C.PerspectiveFrustum) frustum.fov = C.Math.toRadians(Number(input('fov').value));
  if (live.active()) {
    live.tick();
    if (now - lastHud > 100) {
      lastHud = now;
      el('detail-status').textContent = `${fps.toFixed(0)} FPS · ${sceneSource.getStatus() ?? imageryInfo}`;
    }
    return;
  }
  const mode = el<HTMLSelectElement>('altitude-mode').value;
  const canResolve = mode === 'ellipsoid' || terrainHeights.length > 0;
  if (playing && canResolve) time = Math.min(durationSeconds, time + dt * Number(el<HTMLSelectElement>('speed').value));
  if (time >= durationSeconds && playing) { playing = false; syncPlay(); }
  const pose = sampleRoute(time, Number(input('altitude').value));
  const groundM = terrainHeightAt(terrainHeights, time);
  const cameraHeight = resolveHeight(mode, pose.ellipsoidHeightM, groundM);
  if (cameraHeight !== undefined) viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(pose.longitudeDeg, pose.latitudeDeg, cameraHeight),
    orientation: { heading: C.Math.toRadians(pose.headingDeg), pitch: C.Math.toRadians(Number(input('pitch').value)), roll: 0 } });
  if (now - lastHud > 100) {
    lastHud = now;
    el('detail-status').textContent = `${el<HTMLSelectElement>('quality').selectedOptions[0].text} · ${fps.toFixed(0)} FPS · ${sceneSource.getStatus() ?? `${pendingTiles ? pendingTiles + ' terrain/imagery tiles pending' : 'Visible globe tiles loaded'} · ${imageryInfo}`} `;
    el('alt-reference').textContent = mode === 'agl' ? 'ALT · AGL' : 'ALT · WGS84';
    el('height-detail').textContent = cameraHeight === undefined ? terrainStatus : `Camera ${cameraHeight.toFixed(1)} m WGS84 · Ground ${groundM === undefined ? 'unknown' : groundM.toFixed(1) + ' m WGS84'}`;
    el('play').textContent = playing ? (canResolve ? 'Pause' : 'Pause (waiting)') : 'Play';
    el('alt-read').textContent = `${pose.ellipsoidHeightM.toFixed(0)} m`;
    el('heading').textContent = `${pose.headingDeg.toFixed(0).padStart(3, '0')}°`;
    el('position').textContent = `${pose.latitudeDeg.toFixed(5)}° N / ${Math.abs(pose.longitudeDeg).toFixed(5)}° W`;
    el('time').textContent = `${formatTime(time)} / ${formatTime(durationSeconds)}`;
    input('seek').value = String(time);
  }
});
// Avoid advancing replay after a background tab resumes.
document.addEventListener('visibilitychange', () => { previous = performance.now(); });
viewer.scene.renderError.addEventListener(() => {
  playing = false; syncPlay(); el('environment').textContent = 'Rendering failed · reload or check browser WebGL support';
});
