# Incremental flight simulator handoff

Updated: October 18, 2026. Read this first when resuming with Claude or another agent; chat history is not required.

## Authorized scope and latest user decisions

The user wants gradual progress toward a realistic simulator, using a package for flight physics, with validation. The user initially requested a separate branch and has now explicitly requested continuing this work on `main`. They require this handoff so Claude can pick up the work if credits run out.

The user specifically requested two isolated Sandbox modes, named **Simple Free Flight** and **Physics Engine**. Physics Engine must auto-load the C172 and offer a 3D hangar containing only configured physics assets (one C172 for now). Both are implemented. Continuing on `main` is authorized. Deployment and publishing have not been requested.

## Repository state and precautions

- Current working branch: `main`, per the latest user instruction. The original `flight-sim/incremental-dynamics` branch remains available but predates the committed milestone.
- Substantial tracked and untracked application work already existed before this branch, including the sandbox, visual hangar, startup, persistence, location picker, and other layers. It was preserved.
- The application and physics milestone are now committed on `main`, including `7632b73` (engines), `c088258` (state/workflows) and `0065b1f` (workspace wiring). Local commits have not been pushed by this agent.
- Inspect `git status --short` first. Do not reset/clean the workspace or indiscriminately stage everything. At the start of this turn, the only untracked path was `.impeccable/`; preserve it.
- `.env.local` is ignored and may contain a browser-scoped token. Never print or include it in a handoff, commit, screenshot log, or test output.
- Dependencies are installed. Node here is 24.3.0. The browser driver requires Node >=22.12. A local Google Chrome is installed.

## Completed milestone: two modes and actual C172 dynamics

### Engine and renderer

- `src/flightSimulation.ts`: stateful engine contract with separate initial-state/output types, fixed 120 Hz runner, capped catch-up, reset/elapsed clearing, and interpolation without running the engine during drawing.
- `src/sandboxFlight.ts`: original assisted 50 m/s model remains intact; `createSandboxEngine` adapts it to the lifecycle.
- `src/jsbsimEngine.ts`: real JSBSim adapter. Reset starts at configured latitude/longitude, WGS84 ellipsoid height, heading, and 100 kt, with full trim. Arrows apply elevator/aileron deflection, Q/E rudder; throttle and relative pitch trim are explicit inputs. Trimmed aileron/rudder biases must be preserved: overwriting them with zero reintroduces unbalanced propeller torque.
- Important reset detail: JSBSim clears engine controls. Reapply mixture, ignition, engine-running state, rates, speed, and control defaults before RunIC/trim.
- Altitude uses `position/geod-alt-ft`, converted to meters. JSBSim's default ellipsoid is WGS84. `ic/h-sl-ft` is a radial height, slightly different from geodetic height; reset corrects it using the actual geodetic output before trimming. Do not insert EGM96 or treat `h-sl-ft` as the app's WGS84 height.
- Ground track/flight-path angle are derived from NED velocities and remain distinct from body heading/pitch. Director raw control deflections are not passed off as setpoints; the physics director has no synthetic command.
- Euler/position interpolation handles heading/course and longitude wrap. No stateful fractional engine step is used for rendering.
- `src/jsbsimLoader.ts`: lazy SDK/module/binary loading, bounded XML fetches, explicit errors. Vite `?url` imports produce hashed runtime assets in production. `vite.config.js` excludes the package from dependency optimization.

### UI, catalog and persistence

- `src/sandbox.ts`: both modes, loading/ready/failed phases, pause/reset, safe late-load disposal, error recovery, isolated simple progress, throttle/trim controls and IAS/GS/VS readouts. Failed dynamics hold the last valid displayed pose. Relocation resets the engine at the new start. Physics restarts after a BFCache return.
- `src/physicsAircraft.ts`: registry of configured flight models. Only Cessna 172P/JSBSim is present. New physics assets must enter this registry and be wired/tested before appearing in the physics hangar.
- `src/hangar.ts`: existing WebGL preview reused for a filtered physics hangar, with configured model details and a Start C172 flight action. The existing visual-only library remains eight aircraft. This is a single-model picker today, not a general runtime for all visual aircraft.
- `index.html`: mode selector, physics controls, hangar action, and updated control notes.
- `src/workflows.ts` / `src/startup.ts`: both Sandbox paths selectable in setup; saved mode restored.
- `src/applicationState.ts`: additive `sandbox.mode`, defaulting old sessions to `simple`; existing version-1 sessions still decode. Saved `sandbox.current` and `sandbox.paused` belong to Simple Free Flight. Physics never overwrites them. Physics mode selection/start settings persist, but internal engine state does not: reload intentionally starts a fresh trimmed flight. The session message explains this.
- `src/main.ts`: initializes the reusable hangar before Sandbox and uses `sandbox.currentPose()` to center the location picker on the current physics or simple aircraft.
- `src/controlAvailability.ts`: new mode/physics controls follow the existing camera-owner availability policy.

### Dependencies and asset provenance

- Exact runtime: `@0x62/jsbsim-wasm@1.2.4-beta.4` (community wrapper, documented upstream as early development).
- Exact dev browser driver: `puppeteer-core@25.14.0`, using installed Chrome, with no browser download. Initial older test-driver candidate was replaced; final npm installation reported zero vulnerabilities.
- `package.json` and `package-lock.json` include these additions; test command includes real-engine and clock tests.
- `public/flight-dynamics/` contains unchanged C172P aircraft XML and its two propulsion dependencies, upstream COPYING, checksum manifest, and attribution README.
- Source pinned to official JSBSim v1.2.4 commit `e07a7d810d4f1048039d42545d008b8a998636fa`. Asset checksums are verified by tests.
- Preserve original XML license/usage notices. See `public/flight-dynamics/README.md`; visual model credits remain in `public/models/README.md`.

## Validation results

October 18, 2026:

- `npm test`: **67 passed, 0 failed**.
- `npm run build`: TypeScript and Vite production build passed. Existing >500 kB chunk warning remains for EGM96. The WASM binary is about 1.59 MB before compression and is loaded only for Physics Engine.
- `git diff --check`: passed.
- `src/jsbsimEngine.test.ts` uses the REAL bundled WASM/model, not a mock. Proves initialized geodetic position/altitude/heading/airspeed, ten-second trimmed flight, nose-up/right-bank direction, throttle energy response, repeatable reset, southern-hemisphere relocation, frame-rate independence, no advancement during render reads, angular/dateline interpolation, and asset hashes.
- `src/flightSimulation.test.ts`: fixed-clock cadence, compatibility with assisted step, snapshot isolation, pause/reset fractional clearing, invalid elapsed input and capped catch-up.
- `src/applicationState.test.ts`: includes legacy/default mode and separate saved simple progress.
- `scripts/validate-flight-browser.mjs` passed against Vite dev AND production preview in isolated headless Chrome with actual WebGL and WASM, with **zero page JavaScript errors**.
- Browser assertions: both startup paths; C172 auto-load; flight clock; pause; actual 3D hangar framing and one configured aircraft; hangar new-flight action; arrow keys; throttle/trim sliders; cockpit/stable/body/director views; absent invented director command; location dialog suspension and coordinate relocation/reset; isolated simple pose/pause; delayed load cannot change the selected mode; eight-model visual library; deliberate XML 503 failure, disabled controls and retry; reload restores mode but starts a new physics flight.
- Screenshots of both physics controls and rendered C172 hangar were visually inspected. Browser tests block external services to validate the local integration independently. Connected terrain/Google imagery/account access was NOT validated; screenshots can have a blank/star background for this reason. No live/SITL backend check was performed.
- A final session-message text correction is covered by the final build; the substantive engine/UI browser checks were against the preceding build of the same implementation.

Browser evidence: screenshots are under the OS temporary directory in `flight-sim-evidence`. On this machine:
`/private/var/folders/n1/0g7qlvk931351kx48qhz9jzm0000gp/T/flight-sim-evidence/`
Files include `dev-physics.png`, `dev-hangar.png`, `production-physics.png`, and `production-hangar.png`.

## Reproduction

From repository root:

```sh
npm install
npm test
npm run build
npm run dev -- --port 53142 --strictPort
```

In a second terminal:

```sh
node scripts/validate-flight-browser.mjs http://127.0.0.1:53142 dev
```

For production:

```sh
npx vite preview --host 127.0.0.1 --port 53143 --strictPort
node scripts/validate-flight-browser.mjs http://127.0.0.1:53143 production
```

Set `CHROME_PATH` for another installed Chrome path. Default is
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
Set `FLIGHT_EVIDENCE_DIR` to retain screenshots somewhere other than the OS temporary directory.
The tests create an isolated browser profile, block external hosts, and do not send vehicle commands.
Existing user servers occupied 5173 and 5175, so high test ports were used without touching those servers.

## Current limitations and next increments

The completed milestone is airborne C172 dynamics, not a full flight simulator. Calm air only; weather layers do not drive physics. Simple bare-earth contact now freezes Physics Engine and shows the crash overlay (see the terrain milestone below). No landing-gear response, runway operations, takeoff/landing, aircraft systems UI, joystick support, or full engine-state persistence. Physics has no simple-mode altitude clamp; resetting/reloading returns to the configured start. Direct keys return controls to neutral rather than leveling the aircraft. The 3D mesh is a type representation, not a matched cockpit/interior or detailed 172P model.

Recommended next work, with user priorities guiding order:
1. Connected visual flight check over actual terrain/imagery and hands-on evaluation of keyboard sensitivity, trim, and hangar interaction.
2. An explicit stabilization/assistance layer and/or joystick input if desired, while keeping raw engine behavior testable.
3. Physics diagnostics/instrumentation (angle of attack, load factor, engine RPM) before tuning flight handling.
4. Extend the simple stop-on-contact terrain rule only when needed: safe spawn/AGL setup, swept or mesh collision, and then actual landing gear/runway behavior.
5. Wind/turbulence and deliberate atmosphere configuration; do not silently use visual weather overlays as aerodynamic input.
6. Full engine-state save/recovery only after defining a complete snapshot; never fake recovery with position/attitude alone.

No implementation blocker remains for this milestone. Do not repeat the package/engine integration investigation. The real engine and browser paths work. Update this document after each future milestone with exact changes, checks, limitations and next steps. Preserve all pre-existing work and secrets.


## Latest milestone: simple terrain contact and crash overlay

User requested simple terrain collision, then a GTA5-style death overlay saying
**Git gud kid**, with the same stop/reset behavior. Implemented on `main`; the implementation is committed as `3ddcb09`. No push was made. Earlier handoff
sections describing airborne-only flight without contact are superseded here.

- Physics Engine only; Simple Free Flight remains the independent assisted model.
- `src/terrainContact.ts`: 1.5 m aircraft reference-point clearance, using WGS84
  ellipsoid heights. At/below contact height, the app latches a stopped pose just
  above the ground. This is not geometric wheel/wing/body collision or a landing.
- `src/sandboxTerrain.ts`: reads loaded terrain beneath the aircraft and samples
  most-detailed terrain asynchronously at most four times per second with one
  request in flight. Most-detailed cached samples expire after 40 m or 2 seconds;
  loaded terrain is the fallback. Five-second request timeout. Reset, relocation,
  suspension, and provider changes invalidate pending/cached results.
- Bare-earth terrain only; Google building/vegetation surfaces are excluded. The
  initial EllipsoidTerrainProvider is not assumed to be real ground. If no valid
  ground height exists, the HUD says collision unavailable and flight continues.
- `src/sandbox.ts`: checks committed physics state, freezes pose and simulation
  time on contact, disables Pause and physics sliders, preserves the impact
  readouts with an At contact label, and requires Reset to resume flying. No
  native JSBSim terrain/gear response is enabled. Reset, hangar new flight and
  relocation clear the contact latch. Reload already starts a new physics flight.
- `index.html` / `src/style.css`: full-screen modal crash screen with a dark,
  desaturated backdrop, translucent horizontal band, large red **Git gud kid**
  text, and **Reset flight** action. Focus moves to Reset; Escape cannot dismiss
  it. Standard button keyboard activation resets, never resumes a crashed engine.
  Motion respects prefers-reduced-motion. Existing dialogs block steering.
- `src/terrainContact.test.ts`: contact thresholds, negative elevations, missing/
  invalid data, loaded fallback, request limits, expiry, stale-response rejection,
  and offline failure behavior. Included in `npm test`.
- `scripts/validate-terrain-browser.mjs`: actual Cesium heightmap-1.0 fixture tiles
  at 0 m and real JSBSim descent from 100 m. App/engine/Cesium code is unchanged by
  the test; only remote terrain responses are supplied deterministically. Checks
  stop height/time/position, blocked resume, crash text/focus/Escape, overlay Reset,
  isolated simple mode, and unavailable terrain on reload. Screenshots go to the
  same flight-sim-evidence directory as the existing browser suite.

Reproduce with a running dev/preview server:

```sh
node scripts/validate-terrain-browser.mjs http://127.0.0.1:53144 dev
# or point it at the production preview and label it production
```

Validation on October 18, 2026:
- `npm test`: 73 passed, 0 failed (six new terrain tests).
- `npm run build`: TypeScript and production bundling passed; existing EGM96
  chunk-size warning remains.
- Dedicated terrain/crash browser test passed in dev and production with zero
  page errors. Impact occurred at 5.5 s in the dev run and 6.5 s in the production
  run (keyboard input started at different times). Time and position held after
  contact; the overlay reset restored 100 m airborne flight.
- Existing full production flight-browser regression passed with zero page errors.
- Crash overlay screenshot visually inspected. Evidence includes
  `dev-terrain-contact.png` and `production-terrain-contact.png` in the OS temporary
  `flight-sim-evidence` directory. These runs use deterministic flat terrain;
  live mountainous terrain/Google scene contact has not been checked manually.
- `git diff --check` passed. Changes are local on `main`; unrelated `.impeccable/`
  remains untouched. No deployment or push performed.

## Latest steering: random crash messages and visible test options

The user added seven alternative crash lines and requested that straight-line,
figure-eight and feature-enhancement scenarios be available in Demo replay. They
explicitly value small iterations, composability across domain layers, and UI
observability as a proxy for end-to-end trust. Preserve this direction: new
user-visible features should include a selectable validation scenario, with
expected observations and automated checks. See `docs/visual-validation.md`.

Implemented on local `main` (implementation commit `3ddcb09`):
- `src/crashMessages.ts`: eight lines including Git gud kid; selected once per
  collision, not each frame. `src/crashOverlay.ts` shares display/reset/focus
  behavior between the sandbox and validation player.
- `src/validationScenarios.ts`: single registry of IDs, groups, names, expected
  observations and time-based `controlsAt` schedules. Groups are Routes and
  Feature enhancements. Route IDs are `figure-eight` and `straight-line`;
  enhancement IDs are `c172-idle`, `c172-full-power`, `c172-right-bank` and
  `terrain-contact`. New physics scenarios extend the registry rather than
  adding cases to the renderer or engine adapter.
- Real engine recordings run at 120 Hz and are sampled for 12-second replay.
  Recordings use a labeled flat reference deck at 1000 m WGS84, starting at
  1100 m; they do NOT claim to test online geographic terrain sampling.
  Shared `terrainContact` detects the impact and freezes the recorded pose.
- `src/replayScenarios.ts`: populates the selector from the registry, lazy-loads
  the real C172 engine, records/disposes it, displays the deck and existing
  camera views, exposes readouts/expected behavior and shares the crash modal.
  Loading has a timeout and stale-load disposal; Restart retries failed loads.
- `src/main.ts`: scenario-aware replay clock/duration/scrubber, pause and restart,
  option persistence and camera/HUD integration. Physics replay owns recorded
  altitude and attitude; conflicting manual replay overrides are disabled by
  `src/controlAvailability.ts`. Original figure-eight replay retains its existing
  controls and 120-second duration. Startup details reflect the selected scenario.
- New real-engine scenario assertions are in `src/jsbsimEngine.test.ts`. The
  randomized message pool is covered in `src/terrainContact.test.ts`.
- `scripts/validate-replay-browser.mjs` exercises the six grouped UI options,
  actual engine recordings, seek/pause/restart, randomized message stability,
  contact overlay/reset, and restoration of original replay controls.
- Browser scenario tests block external services (including same-origin data
  proxies), preserving repeatability. Screenshots include validation-scenario
  and validation-crash; UI screenshots were visually inspected.

Validation so far: 75 automated tests pass and the production build passes.
The development replay browser suite passed before the final group labels and
registry composition cleanup. Final production browser results are recorded below.
Implementation committed as `3ddcb09`; no push performed. Preserve unrelated local work.

Final scenario validation (October 18, 2026):
- `npm test`: 75 passed, 0 failed. Real-engine scenario tests verify straight-line
  trim, right bank, power energy response, repeatable seeking and contact height.
- Production build passed after final registry composition/group-label changes.
- Production replay browser suite passed with zero page errors: six grouped
  options, all physics recordings, duration/transport, seek/pause/reset,
  randomized message stability and original figure-eight restoration.
- Production terrain browser suite passed after shared randomized-overlay
  integration: actual geographic-terrain adapter driven by deterministic Cesium
  heightmap tiles, contact freeze, focus/Escape behavior, Reset, isolated simple
  mode and unavailable-ground reporting. Zero page errors.
- `git diff --check` passed. Final general sandbox regression is recorded below.
- Final general production flight-browser regression passed with zero page errors,
  covering sandbox modes, camera views, hangar, reset/relocation, persistence
  isolation, load failure/retry and reload. An initial run read the old position
  HUD after a fixed 200 ms delay; the test now waits for the observable relocated
  coordinate before asserting. No application change was needed for that check.


## Commit checkpoint

The user authorized committing the completed work. Implementation and tests are
committed on `main` as `3ddcb09` (Add terrain contact, crash overlays, and visual
flight scenarios). This handoff, the README, CLAUDE instructions and visual
validation design are recorded in a separate documentation commit immediately
afterward. The code was unchanged after the recorded validation results.
Unrelated `.impeccable/` files were deliberately excluded. No push or deployment
was performed. Use `git log -2 --oneline` to inspect the two reviewable commits.

## USB/Bluetooth controller continuation

October 18, 2026: the user authorized generic USB/Bluetooth controls, future HOTAS support, ongoing Claude handoff notes, and incremental commits. Read [controller-handoff.md](controller-handoff.md) for this implementation and future ESP32, SITL, and black-box requirements. That document supersedes the earlier keyboard-only descriptions for Sandbox.
