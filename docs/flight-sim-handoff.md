# Incremental flight simulator handoff

Updated: October 18, 2026. Read this first when resuming with Claude or another agent; chat history is not required.

## Authorized scope and latest user decisions

The user wants gradual progress toward a realistic simulator, using a package for flight physics, on a separate branch with validation. They require this handoff so Claude can pick up the work if credits run out.

The user specifically requested two isolated Sandbox modes, named **Simple Free Flight** and **Physics Engine**. Physics Engine must auto-load the C172 and offer a 3D hangar containing only configured physics assets (one C172 for now). Both are implemented. Deployment, publishing and merging have not been requested.

## Repository state and precautions

- Current branch: `flight-sim/incremental-dynamics`, created from local `main`.
- Substantial tracked and untracked application work already existed before this branch, including the sandbox, visual hangar, startup, persistence, location picker, and other layers. It was preserved.
- No commits or pushes have been made for this increment. A branch name does not back up working files remotely; continuation currently relies on this workspace.
- Inspect `git status --short` first. Do not reset/clean the workspace or indiscriminately stage everything. The tracked diff against HEAD includes older user work and is not a clean measure of this increment.
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

The completed milestone is airborne C172 dynamics, not a full flight simulator. Calm air only; weather layers do not drive physics. No terrain collision, runway contact, takeoff/landing, aircraft systems UI, joystick support, or full engine-state persistence. Physics has no simple-mode altitude clamp; resetting/reloading returns to the configured start. Direct keys return controls to neutral rather than leveling the aircraft. The 3D mesh is a type representation, not a matched cockpit/interior or detailed 172P model.

Recommended next work, with user priorities guiding order:
1. Connected visual flight check over actual terrain/imagery and hands-on evaluation of keyboard sensitivity, trim, and hangar interaction.
2. An explicit stabilization/assistance layer and/or joystick input if desired, while keeping raw engine behavior testable.
3. Physics diagnostics/instrumentation (angle of attack, load factor, engine RPM) before tuning flight handling.
4. Terrain/ground integration as its own milestone: choose terrain source, altitude semantics, contact callbacks and safe spawn conditions, then validate landing gear/runway behavior.
5. Wind/turbulence and deliberate atmosphere configuration; do not silently use visual weather overlays as aerodynamic input.
6. Full engine-state save/recovery only after defining a complete snapshot; never fake recovery with position/attitude alone.

No implementation blocker remains for this milestone. Do not repeat the package/engine integration investigation. The real engine and browser paths work. Update this document after each future milestone with exact changes, checks, limitations and next steps. Preserve all pre-existing work and secrets.
