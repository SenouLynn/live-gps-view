# USB / Bluetooth flight controller handoff

Authorized October 18, 2026: implement generic browser Gamepad input for RadioMaster Boxer ELRS and future HOTAS controllers. Maintain this document for a Claude agent. Work stays on main; preserve unrelated `.impeccable/` files. No commit, push, or deployment requested.

## Implemented design

Use browser Gamepad API for USB and OS-paired Bluetooth. Per-axis device/axis assignment supports separate stick and throttle devices. Persist calibration/mappings, but require explicit session activation. Keyboard remains the default. Use actual shared input normalization for deterministic validation and tests. Wi-Fi/UDP bridges are out of scope.

## Verification

Automated results are recorded below. Physical radio/HOTAS testing requires the user's hardware; simulated browser inputs cannot establish OS/Bluetooth compatibility or latency.

## Future integration requirements (user direction)

- A custom ESP32 controller may come much later. USB/Bluetooth HID firmware can use this Gamepad adapter unchanged if the OS/browser exposes it. Custom serial or network firmware should add a transport adapter producing normalized pilot intent; keep hardware packet formats outside flight dynamics.
- ArduPilot SITL may drive simulations. Treat it as a future simulation/state source with explicit ownership, timestamps, coordinate/unit conversion, lifecycle, pause/reset semantics and telemetry validity. Do not feed externally simulated poses back into JSBSim or advance both engines for the same flight. SITL may also consume normalized pilot intent through its own adapter.
- Black-box logs may drive replay, diagnosis and planning. Decode into a timestamped recording/state contract, preserving measured vs commanded fields, provenance, units and missing/stale data. Keep deterministic seek separate from live clock/input. Existing `FlightEngine`, telemetry adapters, replay recording and application source selection are extension points, not a claim these future integrations already exist.
- `controllerInput.ts` is deliberately independent of DOM, Cesium and JSBSim. Its partial pitch/bank/rudder/throttle values are pilot intent only; persistence and the browser transport live in `controllerPanel.ts`.

Implementation now includes device/axis assignment for each of four flight axes, raw and normalized live values, endpoint/center capture, reverse/deadzone calibration, versioned local storage, session activation, required-device failure pause, and focus-loss pause. Pitch/roll are required; optional rudder/throttle fall back to keyboard/slider. Duplicate device IDs are rejected rather than guessed. USB/Bluetooth pairing is OS-owned. Browser uses HTTPS/localhost. No radio-specific assumptions about axis order.

User authorized incremental commits. Checks and final commit details will be recorded below.

## Validation results and continuation

- `npm test`: 80 passed, 0 failed, including five new controller input tests and real-engine assertions for normalized roll input.
- `npm run build`: passed; existing large-bundle advisory remains.
- Development Chrome controller browser suite passed: endpoint/center capture, saved calibration values, separate stick/throttle mapping, real-engine roll and throttle response, missing-device pause, focus-loss pause, persisted mappings with activation off after reload, keyboard recovery. Zero page errors.
- Development Chrome general flight suite passed: startup, real WASM loading, clock/pause, hangar, controls, views, relocation, reset/mode isolation, load race/failure/retry and reload. Zero page errors.
- Development Chrome replay suite passed: seven selectable scenarios including controller roll, real engine replay, transport/seek, contact/reset and original figure-eight restoration. Zero page errors.
- `git diff --check`: passed. Controller setup screenshot visually inspected. Browser evidence is in the host temporary `flight-sim-evidence` directory, not tracked in git. Build was checked, browser suites used the development server.

Files: `src/controllerInput.ts` (pure normalized input/profile validation), `src/controllerPanel.ts` (Gamepad polling + setup modal), `src/sandbox.ts` (flight integration), `src/controllerInput.test.ts`, `scripts/validate-controller-browser.mjs`, and existing validation registry/replay tests. `README.md` describes user setup. Controller settings key: `synthetic-fpv.controllers.v1`. No new dependencies.

Next useful step: connect the real Boxer on the user's OS/browser, verify USB and BLE enumeration and all stick directions/travel, test disconnected/reconnected behavior, and record firmware/browser versions. Do not assume the automated fake devices prove Bluetooth support. Test physical separate HOTAS devices when available. Same-ID devices are intentionally rejected, button/hat bindings and profile switching are not implemented. No physical hardware was available in this session.

Keep future simulation sources separate from browser pilot input. The existing JSBSim adapter retains its established control scaling; this change does not alter aircraft aerodynamics. Mapped throttle reaches physics at full normalized precision, while its slider/readout displays whole percent.

Implementation checkpoint on main: see `git log -1` for the controller implementation hash. No push or deployment performed. The unrelated `.impeccable/` directory remains untouched.
