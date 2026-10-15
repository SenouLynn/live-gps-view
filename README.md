# Synthetic FPV

A minimal Cesium cockpit prototype: a deterministic two-minute route over Marin Headlands, real streamed terrain and aerial imagery, and a level-horizon camera following inferred course.

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

The renderer uses a deterministic time-based route sampler, independent of rendering cadence. This first slice does not yet ingest the NDJSON fixture or implement the draft subscription interface. YALB-GCS live position and attitude are supported through its SSE backend. External aircraft overlays, generic file replay, and live pose smoothing remain future work. AGL adds the selected height to a pre-sampled terrain profile at 0.25-second route intervals (roughly 9 m along this route), interpolating between samples. It is an approximation of terrain clearance, not a building/tree avoidance system. The HUD shows the reference, terrain elevation and resolved camera height. AGL playback waits for a complete profile; failed or timed-out sampling offers Retry. Ellipsoid mode remains usable without terrain, with no terrain-clearance guarantee. Terrain sampling times out after 30 seconds; late results cannot overwrite a retry.

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
