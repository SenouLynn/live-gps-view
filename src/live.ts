import * as C from 'cesium';
import { VehicleState, parseTelemetry, fresh, cameraAxes } from './telemetry/yalb';
const element = (id: string) => document.getElementById(id)!;

export function setupLive(viewer: C.Viewer) {
  const sourceSelect = element('telemetry-source') as HTMLSelectElement;
  const vehicleSelect = element('vehicle') as HTMLSelectElement;
  const state = new VehicleState();
  let stream: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let connected = false, attempt = 0, held = false;
  let geoid: typeof import('egm96-universal') | undefined;
  let geoidFailed = false;
  let selected = '';
  const isLive = () => sourceSelect.value === 'live';
  const status = (message: string) => { element('telemetry-status').textContent = message; };
  function updateVehicles() {
    const ids = [...state.vehicles.entries()].filter(([, s]) => s.position).map(([id]) => id).sort((a,b) => {
      const [as, ac] = a.split(':').map(Number), [bs, bc] = b.split(':').map(Number);
      return as - bs || ac - bc;
    });
    if (vehicleSelect.options.length === ids.length && ids.every((id, i) => vehicleSelect.options[i].value === id)) return;
    vehicleSelect.replaceChildren(...ids.map(id => new Option(`Vehicle ${id}`, id)));
    if (!ids.includes(selected)) { selected = ids[0] ?? ''; held = false; }
    vehicleSelect.value = selected;
  }
  function connect() {
    if (!isLive()) return;
    status('Connecting to YALB-GCS…');
    const current = new EventSource('/api/events'); stream = current;
    current.onopen = () => {
      if (stream !== current || !isLive()) return;
      connected = true; attempt = 0;
      state.vehicles.clear(); selected = ''; held = false; updateVehicles();
    };
    current.addEventListener('telemetry', (message) => {
      if (stream !== current) return;
      const event = parseTelemetry((message as MessageEvent<string>).data);
      if (event) { state.accept(event); updateVehicles(); }
    });
    current.onerror = () => {
      if (stream !== current || !isLive()) return;
      connected = false;
      if (current.readyState === EventSource.CLOSED && retry === undefined && isLive()) {
        current.close();
        retry = setTimeout(() => { retry = undefined; connect(); }, Math.min(2000 * 2 ** attempt++, 30000));
      }
    };
  }
  function changeSource() {
    clearTimeout(retry); retry = undefined; stream?.close(); stream = undefined; connected = false;
    state.vehicles.clear(); selected = ''; held = false; updateVehicles();
    const live = isLive();
    for (const id of ['play', 'restart', 'seek', 'speed', 'altitude-mode', 'altitude', 'pitch']) {
      (element(id) as HTMLInputElement).disabled = live;
    }
    vehicleSelect.disabled = !live;
    element('source-badge').textContent = live ? '● YALB LIVE' : '● REPLAY';
    element('vehicle-title').textContent = live ? 'YALB-GCS · WAITING FOR VEHICLE' : 'DEMO 01 · MARIN HEADLANDS';
    element('pose-note').textContent = live ? 'Reported MSL altitude · measured attitude when fresh' : 'Synthetic route · inferred course · level horizon';
    status(live ? 'Connecting…' : 'Demo replay · no telemetry connection');
    if (live) {
      if (!geoid) void import('egm96-universal').then(module => { geoid = module; geoidFailed = false; }).catch(() => { geoidFailed = true; });
      connect();
    }
  }
  sourceSelect.onchange = changeSource;
  vehicleSelect.onchange = () => { selected = vehicleSelect.value; held = false; };
  changeSource();
  window.addEventListener('pagehide', () => { clearTimeout(retry); stream?.close(); });
  return {
    active: isLive,
    tick() {
      const now = Date.now();
      const vehicle = state.vehicles.get(selected), position = vehicle?.position;
      const attitude = vehicle?.attitude;
      const positionFresh = position && fresh(position.observed, now);
      const attitudeFresh = attitude && fresh(attitude.observed, now);
      element('vehicle-title').textContent = selected ? `YALB-GCS · VEHICLE ${selected}` : 'YALB-GCS · WAITING FOR VEHICLE';
      element('alt-reference').textContent = 'ALT · MSL';
      element('alt-read').textContent = position ? `${position.msl.toFixed(1)} m` : '—';
      element('time').textContent = position ? `Position age ${Math.max(0, (now - position.observed) / 1000).toFixed(1)} s` : 'Waiting for GLOBAL_POSITION_INT';
      element('position').textContent = position ? `${position.lat.toFixed(5)}°, ${position.lon.toFixed(5)}°` : 'Waiting for position…';
      element('pose-note').textContent = attitudeFresh ? 'Measured attitude · nose-mounted camera' : 'Attitude unavailable/stale · level heading fallback';
      if (!connected || !positionFresh || !geoid) {
        const reason = !connected ? 'Disconnected · reconnecting' : !position ? 'Connected · waiting for position' : !positionFresh ? 'Position stale or clock mismatch' : geoidFailed ? 'Geoid lookup unavailable · switch sources to retry' : 'Loading geoid lookup';
        status(`${reason} · camera ${held ? 'holding last pose' : 'waiting'}`);
        element('height-detail').textContent = 'No fresh resolved live pose';
        element('heading').textContent = '—';
        return;
      }
      const height = position.msl + geoid.meanSeaLevel(position.lat, position.lon);
      const yaw = attitudeFresh ? attitude.yaw : position.heading === undefined ? undefined : C.Math.toRadians(position.heading);
      if (yaw === undefined || !Number.isFinite(height)) { status('Waiting for valid heading/altitude · camera held'); return; }
      const axes = cameraAxes(yaw, attitudeFresh ? attitude.pitch : 0, attitudeFresh ? attitude.roll : 0);
      const destination = C.Cartesian3.fromDegrees(position.lon, position.lat, height);
      const enu = C.Transforms.eastNorthUpToFixedFrame(destination);
      const direction = C.Matrix4.multiplyByPointAsVector(enu, new C.Cartesian3(...axes.direction), new C.Cartesian3());
      const up = C.Matrix4.multiplyByPointAsVector(enu, new C.Cartesian3(...axes.up), new C.Cartesian3());
      viewer.camera.setView({ destination, orientation: { direction, up } });
      held = true;
      element('heading').textContent = `${((C.Math.toDegrees(yaw) + 360) % 360).toFixed(0)}°`;
      element('height-detail').textContent = `Camera ${height.toFixed(1)} m WGS84 · EGM96 conversion`;
      status('Live telemetry · read-only · reported altitude (no AGL override)');
    },
  };
}
