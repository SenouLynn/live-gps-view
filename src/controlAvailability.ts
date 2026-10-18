export interface ControlContext {
  source: string;
  view: string;
  overview: boolean;
  overviewKind?: 'orbit' | 'airspace';
  traffic: boolean;
  trafficFollow: boolean;
  satellites: boolean;
  radar: boolean;
  vehicles: boolean;
  livePose: boolean;
}
/** Empty reason means enabled. All camera owners use this one availability policy. */
export function controlAvailability(c: ControlContext): Record<string, string> {
  const overviewName = c.overviewKind === 'airspace' ? 'airspace map' : 'orbit overview';
  const cameraOwner = c.overview ? `Return from ${overviewName} to use flight controls.`
    : c.trafficFollow ? 'Return to your own vehicle to use these controls.' : '';
  const replay = cameraOwner || (c.source !== 'demo' ? 'Available in Validation demo replay.' : '');
  const sandbox = cameraOwner || (c.source !== 'sandbox' ? 'Available in Sandbox.' : '');
  const view = cameraOwner || (c.source === 'live' ? 'YALB-GCS uses the measured cockpit camera.' : '');
  const follow = view || (c.view === 'cockpit' ? 'Choose a follow or flight director view.' : '');
  const waiting = c.source === 'live' && !c.livePose ? 'Waiting for a usable live GPS pose.' : '';
  return {
    'camera-behavior': c.overview ? `Return from ${overviewName} to change camera behavior.` : !c.trafficFollow ? waiting : '',
    'camera-focus': c.overview ? `Return from ${overviewName} to use camera keys.` : !c.trafficFollow ? waiting : '',
    'camera-reset': c.overview ? `Return from ${overviewName} to recenter the flight camera.` : !c.trafficFollow ? waiting : '',
    play: replay, restart: replay, seek: replay, speed: replay,
    'altitude-mode': replay, altitude: replay,
    pitch: replay || (c.view !== 'cockpit' ? 'Camera pitch applies to the replay cockpit view.' : ''),
    'replay-view': view,
    'follow-distance': follow, 'follow-elevation': follow,
    'sandbox-mode': sandbox, 'physics-hangar': sandbox, 'physics-throttle': sandbox, 'physics-trim': sandbox,
    'sandbox-fly': sandbox, 'sandbox-pause': sandbox, 'sandbox-reset': sandbox,
    vehicle: cameraOwner || (c.source !== 'live' ? 'Available with YALB-GCS telemetry.' : !c.vehicles ? 'Waiting for vehicle discovery.' : ''),
    'traffic-follow': c.overview ? `Return from ${overviewName} to select an aircraft.` : !c.traffic ? 'Enable live aircraft first.' : '',
    'aircraft-models': !c.traffic ? 'Enable live aircraft first.' : '',
    'gnss-paths': !c.satellites ? 'Enable 3D GNSS satellites first.' : '',
    'gnss-labels': !c.satellites ? 'Enable 3D GNSS satellites first.' : '',
    'gnss-above-only': !c.satellites ? 'Enable 3D GNSS satellites first.' : c.overview && c.overviewKind !== 'airspace' ? 'Orbit overview displays all selected satellites.' : '',
    'radar-opacity': !c.radar ? 'Enable observed radar first.' : '',
    'scene-source': c.overview && c.overviewKind !== 'airspace' ? 'Orbit overview uses the terrain globe.' : '',
    fov: c.overview ? `Return from ${overviewName} to change the flight field of view.` : waiting,
  };
}
