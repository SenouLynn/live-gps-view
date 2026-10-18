# Synthetic FPV

A minimal Cesium cockpit prototype: a deterministic two-minute figure eight over Burlington, Vermont, climbing 120 m above the selected base altitude and descending, real streamed terrain and aerial imagery, and a level-horizon camera following inferred course.

## Run locally

```sh
npm install
npm run dev
```

Open the printed local URL. Use Play/Pause, Restart, the route scrubber and playback speed. The default is 25 m above sampled terrain (AGL). Switch the Reference selector to WGS84 ellipsoid for absolute height. Adjust altitude, pitch and field of view. Terrain and imagery require internet access. Google 3D uses the Cesium ion token described below. Provider credits remain visible along the bottom of the view.

```sh
npm test
npm run build
```

## Current scope

The renderer uses a deterministic time-based route sampler, independent of rendering cadence. This first slice does not yet ingest the NDJSON fixture or implement the draft subscription interface. YALB-GCS live position and attitude are supported through its SSE backend. Nearby aircraft overlays and synthetic aircraft-follow views are available separately. Generic file replay and live YALB pose smoothing remain future work. AGL adds the selected height to a pre-sampled terrain profile at 0.25-second route intervals (roughly 9 m along this route), interpolating between samples. It is an approximation of terrain clearance, not a building/tree avoidance system. The HUD shows the reference, terrain elevation and resolved camera height. AGL playback waits for a complete profile; failed or timed-out sampling offers Retry. Ellipsoid mode remains usable without terrain, with no terrain-clearance guarantee. Terrain sampling times out after 30 seconds; late results cannot overwrite a retry.

- [Discovery and architecture](docs/discovery.md)
- [Draft future telemetry contract](src/telemetry/types.ts)
- [Example future wire stream](fixtures/position-stream.ndjson)

Tests cover bearing, route interpolation/endpoints, AGL resolution, unavailable terrain and terrain-profile interpolation/seeks. Production build includes TypeScript checking. Visual browser verification is still required on the target machine.

## Detail modes

High is now the default. The Detail selector lets you compare Balanced, High, and Ultra without changing the route or altitude. High requests finer terrain/imagery tiles, renders at native display resolution, and keeps a larger tile cache. Ultra halves the screen-space error again and renders at 1.25× native resolution; it can increase GPU memory, bandwidth and frame time substantially. Switch to Balanced if motion suffers.

Imagery now uses the ArcGIS service metadata to determine available tile levels and attribution instead of imposing zoom level 19. Available zoom levels do not guarantee better source photography at every location. The status line shows measured render FPS, pending globe tiles and the service's maximum zoom. AGL already samples the provider's most detailed terrain; detail modes change rendering rather than the altitude profile.

These detail modes refine source tiles; the Scene selector chooses between terrain/imagery and Google Photorealistic 3D Tiles. Local Google coverage and low-altitude quality still need visual verification.


## Google Photorealistic 3D

Create `.env.local` with `VITE_CESIUM_ION_TOKEN=your_token_here`, then restart the dev server. Use a browser-visible, read-only Cesium ion token authorized for Google Photorealistic 3D Tiles (asset **2275207**). `.env.local` is ignored by Git; `.env.example` is a safe template. Vite embeds this value in browser code, so it must not be an administrative token.

When configured, Google 3D is selected on startup. The Scene selector switches to terrain/imagery without changing camera controls or the route. Google replaces the visible globe when loaded; attribution stays visible. If loading fails, the viewer returns to terrain with a status message. Selecting Google again retries initial loading. Detail presets also adjust mesh refinement.

AGL remains relative to the independently sampled bare-earth terrain profile, not the Google mesh. Buildings and vegetation can extend above that height. This integration has passed compilation and existing tests, but account authorization, coverage, and browser rendering must be checked locally. No token value is printed by application error handlers.


## Connect to YALB-GCS / SITL

Terminal 1 starts the existing backend and default Copter SITL (the old frontend is unnecessary):

```sh
cd /Users/senoulynn/Desktop/yalb-link
docker compose up
```

Terminal 2 runs this viewer:

```sh
cd /Users/senoulynn/Desktop/live-gps-view
npm install
npm run dev
```

Open Vite's printed URL, choose **Telemetry → YALB-GCS live**, then choose a vehicle if more than one is present. The default remains Demo replay. The backend requests telemetry rates automatically, but starting SITL does not make it take off; use the existing YALB flight scenarios to exercise motion. This viewer never sends vehicle commands.

Vite proxies `/api/events` to `http://127.0.0.1:8080`. To use another backend, set `GCS_BACKEND_URL` in `.env.local` and restart Vite. This server-only setting must be an origin reachable by the machine running Vite. The production static build requires a same-origin `/api/events` reverse proxy; `vite preview` does not provide the development proxy.

Live mode disables demo playback, height override, reference, and pitch controls. Position uses YALB's fused `globalPosition`; MSL height is converted with the bundled EGM96 geoid lookup (lazy-loaded on first connection). Fresh measured attitude drives an FRD/NED-to-ENU camera transform. Missing/stale attitude falls back to a level camera at the reported vehicle heading, not ground course. Missing heading holds the camera. No forward prediction or interpolation is implemented in this first integration.

Position and attitude are independently fresh for two seconds based on backend `observedAt`, allowing at most one second of future clock skew. Stale position or disconnect holds the last camera pose; retained bootstrap samples keep their original timestamps. Browser and backend clocks must agree. Native SSE reconnection handles transient failures; terminal failures recreate the connection with 2–30 second backoff. Reconnection clears old vehicle state, and switching back to demo closes the stream. Vehicles are identified by system/component pair; a backward boot timestamp clears both position and attitude for that vehicle.

Live camera altitude is never lifted onto terrain or roofs. A parked SITL vehicle or a difference between simulator ground and the geographic mesh can place the view inside the surface; this is reported telemetry, not demo AGL mode. The Google scene remains independent of the telemetry source.

Verification: parser/units/default values, stale timestamps, per-vehicle isolation, out-of-order fixes, reboot clearing, and attitude axes are covered by `npm test`. Build/type checks pass. The development SSE proxy was verified end to end against a synthetic local backend. Live SITL, browser rendering and reconnection still require the two-process local check above; the real backend was not reachable during implementation.


## Real aircraft

**Live aircraft** starts enabled and queries public ADSB.lol data within 50 nautical miles of the current camera. This works with demo, SITL, or aircraft-follow viewpoints. No API key is required. **Aircraft cockpit** selects a contact for a course-follow view; choose **Own vehicle / demo** to return. Following a contact suspends demo playback and disables its altitude/pitch controls. Other aircraft stay visible as cyan markers with callsign, position age, prediction/hold state and geometric altitude. Markers are enlarged screen symbols, not aircraft models at physical scale. The traffic status distinguishes nearby contacts from contacts within the camera frame (before terrain/building occlusion). If none are in frame, pitch upward or select an Aircraft cockpit contact. Turning traffic off stops its queries.

The implementation uses ADSB.lol's point endpoint, one request after each 10-second interval, and a 10-second server cache per rounded query location. Failures back off for at least 30 seconds; rate-limit headers extend that delay. Disabling traffic aborts pending requests, stops polling and removes its entities. The query center follows the camera; the data is current wall-clock traffic, even when the underlying demo route is paused or replayed.

Only airborne contacts with valid latitude, longitude, geometric altitude and position age are displayed. readsb defines `alt_geom` as feet above the WGS84 ellipsoid; it is converted directly to meters. Barometric-only contacts are omitted. Course and speed can predict horizontal motion for at most 10 seconds (with geometric vertical rate when supplied), then the position holds; after 30 seconds it disappears. Source timestamps are preserved. No attitude, exact location, complete traffic coverage, or collision-separation guarantee is implied. Aircraft-follow pitch is fixed at −4° with no roll; it is synthetic, not cockpit video. A fresh position is required before camera takeover. Stale choices are disabled. Missing course uses the camera direction captured at selection, visibly labeled, rather than preventing the camera from moving.

Data: [ADSB.lol API](https://www.adsb.lol/docs/open-data/api/), ODbL 1.0. Field semantics: [readsb JSON documentation](https://github.com/wiedehopf/readsb/blob/dev/README-json.md). The checked-out God's Eye View repository also uses ADSB.lol as an aircraft source; this is an independent small integration, not copied controller code.

Restart Vite after updating this integration. The fixed-upstream `/api/traffic` middleware runs in development and `vite preview`. A standalone static deployment needs the equivalent server endpoint. Tests cover feed units/datum, freshness, invalid records and prediction limits. A public response was decoded successfully, and the local proxy was verified against the live upstream, including coordinate validation and cached responses. Browser visuals and local provider coverage still require inspection.


## Wind and observed weather

The **Layers** panel groups aircraft controls and two optional weather layers. Both weather toggles start off. Enable **Forecast wind** and/or **Observed radar** to open a regional weather map beside the cockpit. **Refresh here** centers it on the current camera, snapped to 0.1°; the map spans one degree of latitude and longitude. It stays on that region until you refresh or change weather toggles. This separate north-up map works with both Google 3D and terrain scenes; it is not a radar texture draped over the 3D mesh.

- Wind: nine GFS Seamless samples through Open-Meteo, displayed as arrows pointing downwind with speed in m/s. The center summary reports the meteorological direction the wind comes **from**. These are model-derived **10 m AGL** conditions, not station observations or aircraft-altitude winds. Valid time is shown in Eastern time; model issue time is unavailable from this endpoint. Refreshes every five minutes; fields older than two hours are rejected/removed. No force is applied to the vehicle and no streamlines are implemented yet.
- Radar: NOAA nowCOAST MRMS base reflectivity over the contiguous US, with an exact observation timestamp read from WMS capabilities. The image and legend come from NOAA; an opacity slider adjusts visibility. Reflectivity is dBZ, not rain rate. Radar refreshes every two minutes and images older than 20 minutes are rejected/removed. Gaps or a transparent image do not prove clear weather.
- Basemap: bounded Esri aerial imagery exported to the same geographic box and image size as radar. Missing basemap is reported independently, and the center coordinates remain visible.

Each weather layer cancels requests when disabled; late responses cannot repaint a disabled layer. Server caches are bounded and preserve source timestamps. Upstream failures back off, show unavailable status and remove that product instead of inventing values. Wind/radar use current wall-clock data independently of paused demo replay or SITL.

Weather routes `/api/weather/*` run in Vite development and `vite preview`. Standalone deployment requires equivalent server endpoints. Attribution is shown in the weather card. Open-Meteo's public endpoint has usage and noncommercial eligibility conditions; see https://open-meteo.com/en/terms before a broader deployment. NOAA source: https://nowcoast.noaa.gov/.

Verification: 16 tests cover prior features plus wind field validation/direction, product-specific radar timestamps, stale data and layer cancellation. Live local proxy checks retrieved a nine-point wind field, radar metadata, exact-time radar PNG, NOAA legend and basemap. Browser layout/overlays still need inspection locally; no browser automation tool is available in this session.


## 3D hangar

Open **Layers → 3D hangar** for the eight-aircraft library. Select an aircraft, drag to orbit, scroll to zoom, and use Reset view or Pause rotation. Escape or Close returns to the cockpit. The dedicated Cesium preview has no imagery, terrain or ion requests; its viewer is created only while the dialog is open and destroyed on close. Models are loaded on selection, rather than all eight at startup.

The **3D aircraft models** toggle also shows known live aircraft families within 20 km of the camera at model scale 1. Labels/markers remain available; cockpit-follow hides its own aircraft. Type matching currently covers C172, Bell 206, selected Citation types, ATR 72 variants, Boeing 787/747 variants and MQ-9. These are representative type models, not verified individual aircraft or liveries. Unmatched contacts keep markers, and no military classification is inferred from the chosen model. Model orientation follows reported course with the reference assets' heading calibration; measured bank/pitch are not supplied by this feed.

The eight GLBs are reused unchanged from God's Eye View's attributed CC BY 4.0 model collection. Every model has an original-author link in the hangar; complete sources, licenses and upstream modifications are recorded in [model attribution](public/models/README.md). These asset licenses are separate from application code.

Validation now includes 18 tests: conservative aircraft-family matching and binary GLB/version/length, embedded-resource and attribution checks, in addition to telemetry/weather coverage. Type checking and production build pass. Interactive WebGL appearance, framing, lighting and orientation remain to be checked in the local browser.


## GNSS satellite sky plot

Open **Layers → GNSS sky plot**. The observer starts at the current Cesium camera position and ellipsoid height. It remains pinned while the demo or aircraft moves; choose **Use camera location** to recenter, or edit latitude, longitude and height and select **Apply location**. This does not move the cockpit camera.

The north-up plot places zenith in the center and the geometric horizon at the rim. The elevation mask (0–40°) dims low satellites and updates the above-mask count. GPS, Galileo, GLONASS and BeiDou are enabled initially; optional Other includes augmentation/regional systems present in the catalog. The scrollable table shows azimuth, elevation and predicted elevation 15 minutes ahead. Dashed sky tracks show the next 60 minutes, sampled every five minutes. Positions update every five seconds using current wall-clock time, independently of demo replay.

CelesTrak's GNSS GP catalog supplies OMM JSON elements; satellite.js 6.0.2 performs SGP4/SDP4 propagation and observer look-angle conversion in JavaScript. The fixed server endpoint `/api/gnss-orbits` caches one catalog for two hours, coalesces concurrent requests, and cools down failed fetches for 15 minutes. Reload catalog respects that cache. Orbital elements older than seven days or more than one day ahead are excluded; per-object epoch is available in the plotted marker tooltip. Constellations are identified by names within the GNSS-only catalog (including COSMOS entries for GLONASS), not by arbitrary spacecraft names outside that catalog.

Counts mean **predicted geometric visibility**, not healthy navigation signals, receiver tracking, satellites used in a solution, or a guaranteed fix. The orbital catalog may include unhealthy spacecraft or signals unsupported by a particular receiver. Obstructions, antenna response, atmospheric effects, interference and receiver settings are not modeled. Receiver tracked/used counts and DOP are explicitly unavailable in this first slice. The 3D scene layer is described below; receiver diagnostics comparison remains future work.

The dialog closes with Escape or Close; timers and browser requests stop when closed. Missing data reports unavailable and retains source epoch checks on any previous catalog. No sample positions are substituted into the live display. The endpoint works in Vite development and preview; a static deployment needs an equivalent backend route.

Verified: 22 tests and production build, public catalog parsing (169 objects at verification), physical orbital ranges, angular units, horizon/zenith plotting and stale data. The local endpoint/cache was checked against CelesTrak. Browser appearance remains unverified.

Sources: [CelesTrak GP formats](https://celestrak.org/NORAD/documentation/gp-data-formats.php), [GNSS catalog](https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=json), [satellite.js](https://github.com/shashwatak/satellite-js). The single GPS OMM fixture in `fixtures/gnss-gps-omm.json` is a CelesTrak record fetched October 16, 2026 for deterministic unit tests; it is not used as a live fallback.


## Satellites in the Cesium scene

Enable **Layers → 3D GNSS satellites** to show color-coded GNSS markers at true Earth-fixed orbital positions. Satellite positions use the same CelesTrak/satellite.js propagation as the sky plot, converted from kilometers to Cesium meters. Markers and labels are enlarged symbols, not realistically sized spacecraft. Earth-ellipsoid occlusion prevents far-side markers from showing through the planet, including while the Google mesh is active.

By default, only satellites above the camera observer's elevation mask are shown. The mask and constellation filters are shared with the GNSS sky-plot dialog. Disable **Above observer mask only** for all selected satellites. Labels and next-six-hour paths have independent toggles. Paths are sampled every five minutes, rebuilt every five minutes, and drawn in Earth-fixed coordinates (including Earth rotation); they are future trajectories, not closed inertial ellipses or observed tracks. Markers update once per second using wall-clock time.

From the cockpit, pitch upward to see satellites in the sky; demo pitch now allows −90° through +90°. **Orbit overview** moves out to space and enables mouse orbit/zoom. It pins the observer at the previous cockpit location, shows all selected satellites, temporarily selects the terrain globe, and suspends cockpit/demo camera updates. **Return to cockpit** restores the previous camera, scene source and camera controls; telemetry connections remain alive. Turning off the satellite layer also exits overview and removes all its entities, requests and update timer.

Catalog loading uses the shared two-hour server cache. If loading fails, the status says unavailable; toggle the layer off/on to retry. As with the sky plot, catalog membership and geometric visibility do not establish signal health or actual receiver reception. The observer's mask does not model local buildings or terrain blockage.

Verification: 24 tests and production build pass, including consistency of 3D coordinates with sky-plot angles, correct orbital scale, motion, stale-element exclusion and Earth/near-camera occlusion. WebGL visuals and interactive overview/restore behavior still require local browser verification.


### Workspaces and session recovery

The startup screen separates YALB-GCS live telemetry, Validation (the existing demo replay), and Sandbox. Use **Workspace setup** to change workflows. Sandbox setup accepts starting coordinates, WGS84 altitude, heading, follow distance, and follow elevation; **Reset flight** returns to the configured starting conditions. Changing the starting pose starts a new sandbox flight.

A versioned browser-local session saves the active workflow, camera/scene settings, replay position and play state, and sandbox pose and pause state. Reload opens the saved workspace automatically; simulation time does not advance while the page is closed. Progress checkpoints run every second and on page hide. YALB-GCS reconnects to the configured bridge and discovers fresh vehicles; stale live telemetry is never restored from storage. If browser storage is unavailable, setup shows that persistence is unavailable. Corrupt or unsupported saved sessions return to setup.

Discovery configuration, recovery policies, validation suites, stored procedures, and blackbox imports remain future integration points rather than implemented workflows.

Control availability is defined in `src/controlAvailability.ts`. Replay transport and altitude overrides require Validation; manual pitch requires its cockpit view. Follow settings require a synthetic follow/director view. YALB-GCS and aircraft takeover use cockpit cameras; returning from takeover restores the preferred synthetic view. Sandbox steering is disabled during aircraft takeover and GNSS overview. Orbit overview also disables flight camera, scene selection, and vehicle selection. Traffic model, satellite, and radar options require their respective layers. Disabled controls include a reason in their tooltip, with a flight-control context message in the sidebar.

### Camera keys

Click the flight scene or **Focus camera keys** to use **W/S** to look up/down and **A/D** to look left/right. In follow and director views these keys orbit the aircraft at the selected follow distance. Sandbox arrow keys continue steering independently, and **Space** still pauses the sandbox. **R** or **Recenter** resets the active camera offset.

Choose **Hold look** to retain the angle when you release the keys, or **Return forward on release** for a smooth return to the default viewing direction. Cockpit and follow offsets and the selected behavior persist in the browser session. The cockpit reticle follows the original forward direction as you look away; it pins to the screen edge when forward is out of view. Follow views mark the aircraft. Director views retain their existing projected flight cues. Keys suspend when the canvas loses focus, a dialog opens, or the tab is hidden. Flight-camera keys are disabled during GNSS/airspace overview and while YALB-GCS waits for its initial usable pose.

### Location picker

Use **Choose location · search / map** in Sandbox setup or **Location → Choose / explore** in the top HUD. Search for a city, airport, or landmark, type coordinates, or click the globe to place the marker. The picker has dedicated **+ / −**, **Regional map**, and **Globe** controls. **Airspace map** opens the same picker with ceiling grids enabled. Its independent viewer leaves the flight camera unchanged when closed; FAA overlays are fetched for the visible map center using **Refresh zones here** after panning.

**Start Sandbox here** saves the selected point and resets the current Sandbox flight there, preserving the configured starting altitude and heading. In Live or Validation it instead saves a Sandbox starting point for later; those telemetry sources retain their own positions. Sandbox startup applies the picked point to its coordinate fields before launching. Search results are selectable, and failures leave coordinate entry and globe selection available.

Place search uses Photon with OpenStreetMap attribution: https://github.com/komoot/photon. Requests occur only when Search is submitted, return at most five results, are cached for a day (up to 100 queries), and are throttled. Set the server environment variable `PHOTON_SEARCH_URL` to use a different Photon-compatible endpoint. The Vite dev and preview server provide the search route.

## Location hover

Enable **Flight & camera → Location hover** (off by default) and pause the pointer briefly over the scene. A depth-tested label anchors to the rendered surface and shows latitude, longitude, and surface elevation in meters above the WGS84 ellipsoid. With Google 3D this can be a roof or vegetation; it is not bare-earth elevation or height above ground. Loaded FAA overlays also show their existing source details. Sky and pointer exit hide the label. The preference is saved with the other controls. This feature makes no place-name or address lookup requests. Browser verification of terrain and Google 3D hover remains required.

Location hover also marks the hovered surface with a mint dot. After the pointer settles, sampled bare-earth terrain supplies a gold ground ring and dashed vertical drop guide. The guide intentionally shows through buildings to expose the ground projection; it is not a visible edge of the building. If terrain sampling is unavailable, only the surface dot appears. Ground sampling can load terrain tiles and ignores stale responses after moving or disabling hover.

## Incremental flight simulation

Flight simulation work now continues on `main`. Sandbox setup and the in-flight
**Sandbox mode** selector offer two independent modes:

- **Simple Free Flight** keeps the assisted 50 m/s keyboard flight and saved progress.
- **Physics Engine** auto-loads a Cessna 172P using JSBSim WebAssembly, trimmed airborne
  at 100 kt at the configured starting position and heading. Arrows control elevator
  and ailerons; Q/E controls rudder. Throttle and pitch trim have dedicated sliders.
  Releasing keys centers the controls; it does not automatically level the aircraft.
  IAS, ground speed, and vertical speed come from the engine. Body attitude and flight
  path are distinct; the director shows no invented command setpoints.

**Aircraft · Cessna 172P · 3D hangar** opens the configured physics aircraft catalog,
currently one C172. **Start C172 flight** resets to trimmed starting conditions. The
separate visual aircraft library still contains eight models; those other meshes
have no configured physics model. Physics cannot overwrite the saved simple-flight
pose. Reload preserves the chosen mode and settings, then starts a new trimmed
physics flight. Full engine-state recovery is deferred.

This increment models airborne flight in calm air. Weather overlays do not drive
the engine. Physics Engine detects bare-earth terrain contact with a simple 1.5 m
clearance around the aircraft reference point, freezes the flight, and shows a
GTA-style **Git gud kid** overlay. **Reset flight** returns to the configured airborne
start. This is a stop-on-contact rule, not landing gear, bounce, or mesh collision;
buildings and trees are excluded. Terrain sampling is approximate between requests
(up to 40 m and two seconds); when ground data is missing the HUD reports collision
unavailable and flight continues. Simple Free Flight remains unchanged.
Ground operations, takeoff/landing, and joystick input remain future increments.
There is no altitude clamp in Physics Engine. Reset returns to the configured WGS84 ellipsoid altitude. Assets, licenses,
source revision, and checksums are in [public/flight-dynamics](public/flight-dynamics/README.md).

Validation includes real JSBSim WASM tests, the production build, and a browser
regression that runs against either Vite dev or preview:

```sh
npm test
npm run build
npm run dev -- --port 53142 --strictPort
# In another terminal; set CHROME_PATH if Chrome is elsewhere:
node scripts/validate-flight-browser.mjs http://127.0.0.1:53142 dev
# To validate production instead:
npx vite preview --host 127.0.0.1 --port 53143 --strictPort
node scripts/validate-flight-browser.mjs http://127.0.0.1:53143 production
# Deterministic terrain-contact and crash-overlay test (either dev or preview URL):
node scripts/validate-terrain-browser.mjs http://127.0.0.1:53143 production
```

Browser tests use an isolated headless Chrome, block external services, and write
screenshots to the OS temporary directory under `flight-sim-evidence` (override with
`FLIGHT_EVIDENCE_DIR`). They validate WebGL/WASM/UI behavior independently of online
imagery, terrain, and account access; those external services need a connected check.
The browser driver requires Node 22.12 or newer.

Continuation instructions and current results: [flight simulator handoff](docs/flight-sim-handoff.md).

## Visible test scenarios

Open **Validation**, then **Flight → Test scenario**. **Routes** contains Straight
line (trimmed C172) and Figure eight. **Feature enhancements** contains idle power,
full power, right-bank control, and terrain contact/crash/reset.

The physics options replay actual JSBSim recordings, support pause/scrub/restart
and playback speed, and show the expected observation beside the selector. They
use a clearly labeled flat test deck at 1000 m WGS84 so checks are repeatable
without online terrain. Sandbox terrain contact still uses geographic terrain.
Crash messages are selected randomly once per collision from the eight configured
lines; both modes share the overlay and Reset behavior.

New visible features should have a selectable validation scenario. The shared
contract and extension process are described in [visual validation](docs/visual-validation.md).
