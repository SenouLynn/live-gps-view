import * as C from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { parseLocation, locationZoomHeight, type LocationPoint } from './location';
import { createAirspaceDataSource } from './layers/airspace';
import { airspaceKinds, airspaceLabel, type AirspaceKind } from './layers/airspaceData';
const el = (id: string) => document.getElementById(id)!;
const input = (id: string) => el(id) as HTMLInputElement;
const dialog = el('location-dialog') as HTMLDialogElement;
interface PickerOptions { initial: LocationPoint; airspace?: boolean; onSelect(point: LocationPoint): void; action?: string }
let viewer: C.Viewer | undefined, selected: C.Entity | undefined, options: PickerOptions;
let initializing: Promise<void> | undefined;
let searchController: AbortController | undefined;
let layerGeneration = 0;
const controllers = new Set<AbortController>();
const sources = new Map<AirspaceKind, C.GeoJsonDataSource>();
const status = (message: string) => { el('location-status').textContent = message; };
function setPoint(point: LocationPoint, pan = false) {
  input('location-lat').value = point.lat.toFixed(6); input('location-lon').value = point.lon.toFixed(6);
  if (selected) selected.position = new C.ConstantPositionProperty(C.Cartesian3.fromDegrees(point.lon,point.lat));
  if (pan && viewer) {
    viewer.camera.cancelFlight();
    viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(point.lon,point.lat,65000), orientation: { heading:0,pitch:-Math.PI/2,roll:0 } });
  }
  viewer?.scene.requestRender();
}
function readPoint() { return parseLocation(input('location-lat').value.trim(),input('location-lon').value.trim()); }
function cancelLayers() { layerGeneration++; for (const controller of controllers) controller.abort(); controllers.clear(); }
async function refreshLayers() {
  if (!viewer || !dialog.open) return;
  const enabled = airspaceKinds.some(kind => input(`location-${kind}`).checked);
  (el('location-refresh-zones') as HTMLButtonElement).disabled = !enabled;
  el('location-refresh-zones').title = enabled ? '' : 'Enable an airspace layer first.';
  cancelLayers(); const generation = layerGeneration;
  const v = viewer;
  for (const source of sources.values()) v.dataSources.remove(source,true);
  sources.clear();
  // Query the map's center rather than the elevated camera's orbital position.
  const pixel = new C.Cartesian2(v.canvas.clientWidth/2,v.canvas.clientHeight/2);
  const center = v.camera.pickEllipsoid(pixel) ?? v.camera.positionWC;
  const cartographic = C.Cartographic.fromCartesian(center);
  const lat = C.Math.toDegrees(cartographic.latitude), lon = C.Math.toDegrees(cartographic.longitude);
  el('location-layer-region').textContent = `Queried region: ${lat.toFixed(2)}°, ${lon.toFixed(2)}° · 1° × 1° · FAA U.S. coverage`;
  await Promise.allSettled(airspaceKinds.map(async kind => {
    const message = el(`location-${kind}-status`);
    if (!input(`location-${kind}`).checked) { message.textContent = 'Off'; return; }
    const controller = new AbortController(); controllers.add(controller);
    const signal = controller.signal;
    message.textContent = 'Loading FAA data…';
    let data: C.GeoJsonDataSource | undefined;
    try {
      const response = await fetch(`/api/airspace?${new URLSearchParams({kind,lat:String(lat),lon:String(lon)})}`,{signal});
      if (!response.ok) throw new Error(response.status === 429 ? 'rate-limit' : 'unavailable');
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('api');
      const payload = await response.json(); signal.throwIfAborted();
      if (payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) throw new Error('invalid');
      data = await createAirspaceDataSource(payload,kind); signal.throwIfAborted();
      for (const entity of data.entities.values) {
        const color = entity.properties?.overlayColor?.getValue();
        if (entity.polygon && color) entity.polygon.material = new C.ColorMaterialProperty(C.Color.fromCssColorString(color).withAlpha(.35));
      }
      await v.dataSources.add(data);
      if (signal.aborted || generation !== layerGeneration || !dialog.open) { v.dataSources.remove(data,true); return; }
      sources.set(kind,data);v.scene.requestRender();
      message.textContent = `${payload.features.length} features${payload.partial ? ' · partial coverage' : ''} · fetched ${new Date(payload.retrievedAt).toLocaleTimeString()} · source edited ${Number.isFinite(payload.sourceUpdatedAt) ? new Date(payload.sourceUpdatedAt).toLocaleDateString() : 'unknown'}`;
      if (!payload.features.length) message.textContent += ' · flight permission unknown';
    } catch (error) {
      if (data && sources.get(kind) !== data) v.dataSources.remove(data,true);
      if (!signal.aborted) message.textContent = error instanceof Error && error.message === 'rate-limit' ? 'FAA rate limited · retry in one minute'
        : error instanceof Error && error.message === 'api' ? 'API unavailable · restart Vite and retry' : 'FAA layer unavailable · Refresh zones to retry';
    } finally { controllers.delete(controller); }
  }));
}
async function initialize() {
  viewer = new C.Viewer('location-globe',{baseLayer:false,terrainProvider:new C.EllipsoidTerrainProvider(),animation:false,timeline:false,baseLayerPicker:false,geocoder:false,
    homeButton:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,selectionIndicator:false,infoBox:false,requestRenderMode:true});
  const v = viewer;
  v.scene.globe.baseColor = C.Color.fromCssColorString('#253942');
  v.scene.screenSpaceCameraController.enableTilt = false;
  v.scene.screenSpaceCameraController.enableLook = false;
  v.scene.screenSpaceCameraController.minimumZoomDistance = 200;
  v.scene.screenSpaceCameraController.maximumZoomDistance = 25000000;
  v.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  selected = v.entities.add({position:C.Cartesian3.fromDegrees(options.initial.lon,options.initial.lat), point:{pixelSize:13,color:C.Color.fromCssColorString('#9fe8c6'),outlineColor:C.Color.BLACK,outlineWidth:3,disableDepthTestDistance:Number.POSITIVE_INFINITY}});
  v.screenSpaceEventHandler.setInputAction((event: {position:C.Cartesian2}) => {
    const point = v.camera.pickEllipsoid(event.position);
    if (!point) { status('Click a point on the Earth to select a location.'); return; }
    const p = C.Cartographic.fromCartesian(point);
    const location = parseLocation(C.Math.toDegrees(p.latitude),C.Math.toDegrees(p.longitude));
    if (!location) { status('Choose a latitude between −85° and 85°.'); return; }
    setPoint(location); status('Location selected. Use this point or continue exploring.');
    const picked = v.scene.pick(event.position);
    el('location-zone-detail').textContent = '';
    if (picked?.id instanceof C.Entity) for (const [kind, data] of sources) if (data.entities.contains(picked.id)) {
      const p = picked.id.properties?.getValue(C.JulianDate.now()) ?? {};
      el('location-zone-detail').textContent = kind === 'ceilings'
        ? `${String(p.APT1_NAME || 'FAA facility grid')} · ${airspaceLabel(kind,p).text} authorization threshold · effective ${String(p.MAP_EFF || 'not supplied')}`
        : kind === 'sites' ? `${airspaceLabel(kind,p).text} · ceiling: ${String(p.CEILING ?? 'unknown')} ${String(p.UNIT || '')}`
        : `${airspaceLabel(kind,p).text} · lower: ${String(p.Floor ?? 'unknown')} · upper: ${String(p.Ceiling ?? 'unknown')} (source limits)`;
    }
  },C.ScreenSpaceEventType.LEFT_CLICK);
  void (async () => { try {
    const imagery = await C.ArcGisMapServerImageryProvider.fromUrl('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',{enablePickFeatures:false});
    v.imageryLayers.addImageryProvider(imagery);v.scene.requestRender();
    imagery.errorEvent.addEventListener(() => { if (dialog.open) status('Some aerial tiles are unavailable. Coordinates and selection still work.'); });
  } catch { if(dialog.open) status('Aerial imagery unavailable. Coordinates and globe selection still work.'); } })();
}
export async function openLocationPicker(next: PickerOptions) {
  if (dialog.open) return;
  options = next;
  dialog.showModal();
  (el('location-use') as HTMLButtonElement).disabled = true;
  el('location-use').textContent = next.action ?? 'Use as Sandbox start';
  el('location-results').replaceChildren();
  el('location-zone-detail').textContent = '';
  status('Preparing location map…');
  try {
    if (!viewer) { initializing ??= initialize(); await initializing; }
    if (!dialog.open || !viewer) return;
    viewer.useDefaultRenderLoop = true; viewer.resize();
    setPoint(next.initial,true);
    if (next.airspace) input('location-ceilings').checked = true;
    (el('location-use') as HTMLButtonElement).disabled = false;
    status('Search a place, enter coordinates, or click the globe. Drag to pan; use + / − to zoom.');
    void refreshLayers();
  } catch { initializing = undefined; status('The map could not start. You can still enter coordinates and use this point.'); (el('location-use') as HTMLButtonElement).disabled = false; setPoint(next.initial); }
}
el('location-close').onclick = () => dialog.close();
dialog.addEventListener('close',() => {searchController?.abort();cancelLayers();if(viewer)viewer.useDefaultRenderLoop=false;});
el('location-use').onclick = () => {
  const point = readPoint();
  if (!point) { status('Enter latitude −85 to 85 and longitude −180 to 180.'); return; }
  options.onSelect(point);dialog.close();
};
el('location-coordinates').addEventListener('submit',event => {
  event.preventDefault();const point=readPoint();if(!point){status('Enter valid coordinates.');return;}setPoint(point,true);status('Map centered on your coordinates.');void refreshLayers();
});
for (const [id,factor] of [['location-zoom-in',.5],['location-zoom-out',2]] as const) el(id).onclick = () => {
  if(!viewer)return;const p=viewer.camera.positionCartographic;
  viewer.camera.cancelFlight();viewer.camera.setView({destination:C.Cartesian3.fromRadians(p.longitude,p.latitude,locationZoomHeight(p.height,factor)),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});
};
el('location-world').onclick = () => {if(!viewer)return;const p=viewer.camera.positionCartographic;viewer.camera.setView({destination:C.Cartesian3.fromRadians(p.longitude,p.latitude,20000000),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});};
el('location-regional').onclick = () => {const point=readPoint();if(point){setPoint(point,true);void refreshLayers();}};
el('location-refresh-zones').onclick = () => {void refreshLayers();};
for (const kind of airspaceKinds) input(`location-${kind}`).onchange = () => {void refreshLayers();};
el('location-search-form').addEventListener('submit',async event => {
  event.preventDefault();searchController?.abort();const controller=new AbortController();searchController=controller;
  const query=input('location-query').value.trim();if(query.length<2){status('Enter at least two characters.');return;}
  const results=el('location-results');results.replaceChildren();status('Searching places…');
  try {
    const response=await fetch(`/api/locations/search?${new URLSearchParams({q:query})}`,{signal:controller.signal});
    if(!response.ok)throw new Error(response.status===429?'rate-limit':'unavailable');
    const data=await response.json();controller.signal.throwIfAborted();
    if(!Array.isArray(data.results))throw new Error('invalid');
    for(const result of data.results){
      const point=parseLocation(result.lat,result.lon);if(!point||typeof result.label!=='string')continue;
      const button=document.createElement('button');button.type='button';button.textContent=result.label;
      button.onclick=()=>{setPoint(point,true);results.replaceChildren();status(result.label);void refreshLayers();};results.append(button);
    }
    status(results.childElementCount?'Choose a result to move the map.':'No matching places. Try a city or airport name, or enter coordinates.');
  }catch(error){if(!controller.signal.aborted)status(error instanceof Error&&error.message==='rate-limit'?'Search rate limited. Wait a moment before trying again.':'Place search unavailable. You can still enter coordinates or click the map.');}
});
window.addEventListener('pagehide',()=>{searchController?.abort();cancelLayers();viewer?.destroy();});
