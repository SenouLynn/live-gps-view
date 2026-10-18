import * as C from 'cesium';
import { airspaceKinds, airspaceLabel, type AirspaceKind } from './airspaceData';
const el = (id: string) => document.getElementById(id)!;
const check = (id: string) => el(id) as HTMLInputElement;
export async function createAirspaceDataSource(payload: object, kind: AirspaceKind) {
  const data = await C.GeoJsonDataSource.load(payload, { clampToGround: true, stroke: C.Color.TRANSPARENT });
  for (const entity of data.entities.values) {
    const properties = entity.properties?.getValue(C.JulianDate.now()) ?? {};
    const style = airspaceLabel(kind, properties);
    if (!entity.properties) entity.properties = new C.PropertyBag();
    entity.properties.addProperty('overlayColor', style.color);
    if (entity.polygon) {
      entity.polygon.classificationType = new C.ConstantProperty(C.ClassificationType.BOTH);
      const points = entity.polygon.hierarchy?.getValue(C.JulianDate.now())?.positions;
      if (points?.length) {
        const midpoint = C.Ellipsoid.WGS84.scaleToGeodeticSurface(C.BoundingSphere.fromPoints(points).center);
        if (midpoint) entity.position = new C.ConstantPositionProperty(midpoint);
      }
    }
    if (entity.position) entity.label = new C.LabelGraphics({ text: style.text, font: '12px monospace', fillColor: C.Color.fromCssColorString(style.color),
      outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE,
      heightReference: C.HeightReference.CLAMP_TO_GROUND, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 180000),
      pixelOffset: new C.Cartesian2(0, -8) });
  }
  return data;
}
export function setupAirspace(viewer: C.Viewer, openMap: () => void) {
  let center = { lat: 44.5, lon: -73.2 };
  const layers = new Map<AirspaceKind, { generation: number; controller?: AbortController; data?: C.GeoJsonDataSource; updated?: number }>();
  for (const kind of airspaceKinds) layers.set(kind, { generation: 0 });
  function appearance() {
    for (const layer of layers.values()) for (const entity of layer.data?.entities.values ?? []) {
      if (entity.polygon) entity.polygon.material = new C.ColorMaterialProperty(C.Color.fromCssColorString(String(entity.properties?.overlayColor?.getValue())).withAlpha(Number(check('airspace-opacity').value) / 100));
      if (entity.label) entity.label.show = new C.ConstantProperty(check('airspace-labels').checked);
    }
  }
  function clear(kind: AirspaceKind) {
    const layer = layers.get(kind)!;
    layer.generation++; layer.controller?.abort();
    if (layer.data) viewer.dataSources.remove(layer.data, true);
    layer.data = undefined; layer.updated = undefined;
  }
  async function load(kind: AirspaceKind) {
    clear(kind);
    const layer = layers.get(kind)!, generation = layer.generation;
    const status = el(`airspace-${kind}-status`);
    if (!check(`airspace-${kind}`).checked) { status.textContent = 'Off'; return; }
    layer.controller = new AbortController();
    const signal = layer.controller.signal;
    status.textContent = 'Loading FAA data…';
    let data: C.GeoJsonDataSource | undefined;
    let phase: 'request' | 'render' = 'request';
    try {
      const response = await fetch(`/api/airspace?${new URLSearchParams({ kind, lat: String(center.lat), lon: String(center.lon) })}`, { signal });
      if (!response.ok) throw new Error(response.status === 429 ? 'Rate limited' : 'Layer unavailable');
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('API unavailable');
      const payload = await response.json(); signal.throwIfAborted();
      if (payload.type !== 'FeatureCollection' || !Array.isArray(payload.features) || !Number.isFinite(payload.retrievedAt)) throw new Error('Invalid data');
      phase = 'render';
      data = await createAirspaceDataSource(payload, kind);
      signal.throwIfAborted();
      await viewer.dataSources.add(data);
      if (signal.aborted || generation !== layer.generation) { viewer.dataSources.remove(data, true); return; }
      layer.data = data; layer.updated = payload.retrievedAt; appearance();
      const updated = Number.isFinite(payload.sourceUpdatedAt) ? new Date(payload.sourceUpdatedAt).toLocaleString() : 'not supplied';
      status.textContent = `${payload.features.length} features${payload.partial ? ' · PARTIAL COVERAGE (feature limit)' : ''} · fetched ${new Date(payload.retrievedAt).toLocaleTimeString()} · source edited ${updated}`;
      if (!payload.features.length) status.textContent += ' · no features returned; flight permission unknown';
    } catch (error) {
      if (data && layer.data !== data) viewer.dataSources.remove(data, true);
      if (!signal.aborted) {
        if (phase === 'render') {
          status.textContent = 'FAA data received but drawing failed · see browser console';
          console.error('Airspace overlay rendering failed', error);
        } else if (error instanceof Error && error.message === 'API unavailable') {
          status.textContent = 'Airspace API unavailable · restart the Vite dev server, then Refresh here';
        } else {
          status.textContent = error instanceof Error && error.message === 'Rate limited'
            ? 'FAA rate limited · coverage unknown · retry after one minute'
            : 'FAA layer unavailable · coverage unknown · Refresh here to retry';
        }
      }
    }
  }
  function hoverDetail(entity: unknown): string | undefined {
    if (!(entity instanceof C.Entity)) return;
    for (const [kind, layer] of layers) if (layer.data?.entities.contains(entity)) {
      const p = entity.properties?.getValue(C.JulianDate.now()) ?? {};
      const label = airspaceLabel(kind, p).text;
      return kind === 'ceilings'
        ? `${String(p.APT1_NAME || 'FAA facility grid')} · ${label} authorization threshold · map effective ${String(p.MAP_EFF || 'not supplied')}`
        : kind === 'sites' ? `${label} · ceiling: ${String(p.CEILING ?? 'not supplied')} ${String(p.UNIT || '(unit not supplied)')} · site conditions and access require verification`
        : `${label} · ${String(p.Reason || 'Security restriction')} · lower limit: ${String(p.Floor ?? 'not supplied')} · upper limit: ${String(p.Ceiling ?? 'not supplied')} (source values)`;
    }
  }
  const picker = new C.ScreenSpaceEventHandler(viewer.scene.canvas);
  picker.setInputAction((event: { position: C.Cartesian2 }) => {
    const detail = hoverDetail(viewer.scene.pick(event.position)?.id);
    if (detail) el('airspace-detail').textContent = detail;
  }, C.ScreenSpaceEventType.LEFT_CLICK);
  function refresh(point?: {lat:number;lon:number}) {
    const camera = viewer.camera.positionCartographic;
    center = { lat: Math.round((point?.lat ?? C.Math.toDegrees(camera.latitude)) * 10) / 10, lon: Math.round((point?.lon ?? C.Math.toDegrees(camera.longitude)) * 10) / 10 };
    el('airspace-region').textContent = `${center.lat.toFixed(1)}°, ${center.lon.toFixed(1)}° · 1° × 1° region · U.S. data`;
    el('airspace-detail').textContent = 'Click a zone for its source details. Refresh here after moving the map.';
    for (const kind of airspaceKinds) void load(kind);
  }
  for (const kind of airspaceKinds) check(`airspace-${kind}`).onchange = () => refresh();
  el('airspace-refresh').onclick = () => refresh();
  check('airspace-labels').onchange = appearance;
  check('airspace-opacity').oninput = appearance;
  el('airspace-overview').onclick = openMap;
  const timer = setInterval(() => {
    for (const [kind, layer] of layers) if (layer.updated && Date.now() - layer.updated > 10 * 60000) {
      clear(kind); el(`airspace-${kind}-status`).textContent = 'Overlay expired · Refresh here for current data';
    }
  }, 30000);
  window.addEventListener('pagehide', () => { clearInterval(timer); picker.destroy(); for (const kind of layers.keys()) clear(kind); });
  refresh();
  return { refresh, hoverDetail };
}
