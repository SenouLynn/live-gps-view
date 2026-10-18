import * as C from 'cesium';
import type { setupCameraControls } from './cameraControls';
import { modelForAircraft } from './aircraftModels';
import { projectTrafficPoint } from './trafficProjection';
import { parseAircraft, aircraftPose, aircraftFollowPose, type Aircraft } from './telemetry/aircraft';
export function setupTraffic(viewer: C.Viewer, cameraControls: ReturnType<typeof setupCameraControls>) {
  const toggle = document.getElementById('traffic-enabled') as HTMLInputElement;
  const follow = document.getElementById('traffic-follow') as HTMLSelectElement;
  const status = document.getElementById('traffic-status')!;
  const layer = viewer.dataSources.add(new C.CustomDataSource('ADSB.lol live aircraft'));
  let dataSource: C.CustomDataSource | undefined;
  void layer.then(value => { dataSource = value; });
  const tracks = new Map<string, { aircraft: Aircraft; entity: C.Entity; modelKey?: string }>();
  let controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0, lastSuccess = 0, error = '', inFlight = false;
  let acquired = '';
  let fallbackHeading = 0;
  const enabled = () => toggle.checked;
  function clear() {
    generation++; controller?.abort(); clearTimeout(timer); inFlight = false;
    acquired = '';
    tracks.clear(); dataSource?.entities.removeAll(); follow.replaceChildren(new Option('Own vehicle / demo', ''));
    lastSuccess = 0; error = '';
  }
  async function poll() {
    if (!enabled() || inFlight || !dataSource) { if (enabled()) timer = setTimeout(poll, 1000); return; }
    inFlight = true;
    const epoch = generation;
    const camera = viewer.camera.positionCartographic;
    const lat = C.Math.toDegrees(camera.latitude), lon = C.Math.toDegrees(camera.longitude);
    const requestController = new AbortController();
    controller = requestController;
    const timeout = setTimeout(() => requestController.abort(), 15000);
    let delay = 10000;
    try {
      const response = await fetch(`/api/traffic?lat=${lat.toFixed(1)}&lon=${lon.toFixed(1)}`, { signal: requestController.signal });
      if (!response.ok) {
        delay = Math.min(300000, Math.max(30000, Number(response.headers.get('retry-after')) * 1000 || 30000));
        throw new Error(response.status === 429 ? 'Feed rate limited' : 'Feed unavailable');
      }
      const aircraft = parseAircraft(await response.json());
      if (epoch !== generation) return;
      const present = new Set(aircraft.map(a => a.id));
      for (const [id, track] of tracks) if (!present.has(id)) { dataSource.entities.remove(track.entity); tracks.delete(id); }
      for (const a of aircraft) {
        const existing = tracks.get(a.id);
        if (existing) { if (a.observed >= existing.aircraft.observed) existing.aircraft = a; }
        else {
          const entity = dataSource.entities.add({ id: `traffic-${a.id}`, position: C.Cartesian3.fromDegrees(a.lon, a.lat, a.height),
            point: { pixelSize: 8, color: C.Color.CYAN, outlineColor: C.Color.BLACK, outlineWidth: 1 },
            label: { text: a.callsign, font: '12px monospace', fillColor: C.Color.CYAN, showBackground: true,
              pixelOffset: new C.Cartesian2(12, -12), horizontalOrigin: C.HorizontalOrigin.LEFT },
          });
          tracks.set(a.id, { aircraft: a, entity });
        }
      }
      const selected = follow.value;
      follow.replaceChildren(new Option('Own vehicle / demo', ''), ...aircraft.map(a => {
        const option = new Option(`${a.callsign} · ${a.id}${aircraftPose(a, Date.now()) ? '' : ' · stale'}`, a.id);
        option.disabled = !aircraftPose(a, Date.now());
        return option;
      }));
      if (selected) {
        if (!present.has(selected)) follow.add(new Option(`${selected} · signal lost (camera held)`, selected));
        follow.value = selected;
      }
      lastSuccess = Date.now(); error = '';
    } catch (e) {
      if (epoch !== generation) return;
      error = e instanceof Error && e.message === 'Feed rate limited' ? e.message : 'Feed unavailable';
      delay = Math.max(delay, 30000);
    } finally {
      clearTimeout(timeout);
      if (epoch === generation) { inFlight = false; if (enabled()) timer = setTimeout(poll, delay); }
    }
  }
  function changeTraffic() { clear(); if (enabled()) void poll(); else status.textContent = 'Aircraft traffic off'; }
  toggle.onchange = changeTraffic;
  changeTraffic();
  follow.onchange = () => {
    acquired = '';
    fallbackHeading = C.Math.toDegrees(viewer.camera.heading);
    if (follow.value && !aircraftFollowPose(tracks.get(follow.value)?.aircraft, Date.now(), fallbackHeading)) {
      follow.value = '';
      error = 'Contact has no fresh position · choose another aircraft';
    }
   
  };
  document.getElementById('telemetry-source')!.addEventListener('change', () => { follow.value = ''; acquired = ''; });
  window.addEventListener('pagehide', clear);
  return {
    tick(): boolean {
      if (!enabled()) return false;
      const now = Date.now();
      // Keep stale entries visible as disabled, never offer a takeover that cannot move the camera.
      for (const option of Array.from(follow.options)) {
        if (option.value) option.disabled = !aircraftFollowPose(tracks.get(option.value)?.aircraft, now, fallbackHeading);
      }
      const selected = follow.value;
      let visible = 0, inFrame = 0;
      for (const track of tracks.values()) {
        const { aircraft, entity } = track;
        const pose = aircraftPose(aircraft, now);
        entity.show = !!pose && aircraft.id !== selected;
        if (!pose) continue;
        visible++;
        if (aircraft.id === selected) continue;
        const world = C.Cartesian3.fromDegrees(pose.lon, pose.lat, pose.height);
        entity.position = new C.ConstantPositionProperty(world);
        const model=(document.getElementById('aircraft-models') as HTMLInputElement).checked && C.Cartesian3.distance(world,viewer.camera.positionWC)<20000 ? modelForAircraft(aircraft.type) : undefined;
        if(track.modelKey!==model?.id){
          entity.model=model?new C.ModelGraphics({uri:`/models/${model.file}`,scale:1,minimumPixelSize:0,runAnimations:true}):undefined;
          track.modelKey=model?.id;
        }
        if(model && aircraft.course!==undefined)entity.orientation=new C.ConstantProperty(C.Transforms.headingPitchRollQuaternion(world,new C.HeadingPitchRoll(C.Math.toRadians(aircraft.course+180),0,0)));

        const screen = projectTrafficPoint(viewer.scene, world, false);
        if (screen && screen.x >= 0 && screen.y >= 0 && screen.x <= viewer.canvas.clientWidth && screen.y <= viewer.canvas.clientHeight) inFrame++;


        if (entity.label) entity.label.text = new C.ConstantProperty(`${aircraft.callsign} · ${pose.age.toFixed(0)}s ${pose.state}\n${Math.round(pose.height)} m WGS84${model ? ' · model: '+model.name+' (representative)' : ''}`);
      }
      status.textContent = `ADSB.lol · ${visible} nearby · ${inFrame} in camera frame · 50 NM · ${error || (lastSuccess ? 'updated ' + Math.round((now - lastSuccess) / 1000) + 's ago' : 'loading…')}`;
      if (!selected) {
        if (visible && !inFrame) status.textContent += ' · try pitching up or select Aircraft cockpit';
        return false;
      }
      const aircraft = tracks.get(selected)?.aircraft;
      const pose = aircraftFollowPose(aircraft, now, fallbackHeading);
      if (!pose && acquired !== selected) {
        follow.value = '';
       
        status.textContent += ' · selected contact has no fresh position; camera unchanged';
        return false;
      }
      document.getElementById('source-badge')!.textContent = '● AIRCRAFT FEED';
      document.getElementById('vehicle-title')!.textContent = `ADSB.lol · ${aircraft?.callsign ?? selected}`;
      document.getElementById('pose-note')!.textContent = 'Synthetic course-follow view · attitude not measured';
      document.getElementById('telemetry-status')!.textContent = pose ? `Aircraft position ${pose.age.toFixed(1)}s old · ${pose.state}` : 'Aircraft signal lost · camera held';
      if (!pose) { cameraControls.hold(); return true; }
      viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(pose.lon, pose.lat, pose.height), orientation: { heading: C.Math.toRadians(pose.heading), pitch: C.Math.toRadians(-4), roll: 0 } });
      cameraControls.cockpit();
      acquired = selected;
      if (pose.headingInferred) document.getElementById('pose-note')!.textContent = 'Course unavailable · using initial camera direction';
      document.getElementById('alt-reference')!.textContent = 'ALT · WGS84';
      document.getElementById('alt-read')!.textContent = `${Math.round(pose.height)} m`;
      document.getElementById('heading')!.textContent = `${Math.round(pose.heading)}°`;
      document.getElementById('position')!.textContent = `${pose.lat.toFixed(5)}°, ${pose.lon.toFixed(5)}°`;
      document.getElementById('height-detail')!.textContent = 'Geometric ADS-B altitude · no ground clamp';
      document.getElementById('time')!.textContent = 'Live aircraft · demo replay suspended';
      return true;
    },
  };
}
