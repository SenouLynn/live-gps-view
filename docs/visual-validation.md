# Visual validation as a feature contract

New user-visible flight features should arrive with a selectable scenario in
**Validation → Flight → Test scenario**, plus automated checks for the behavior
being introduced. Keep additions small enough that their expected result can be
observed, replayed and compared. This convention also applies when another agent
continues the project.

## Shared composition

| Layer | Responsibility |
| --- | --- |
| `validationScenarios.ts` registry | Scenario ID, UI group/name, expected observation, and time-based control inputs. |
| Flight engine adapter | Actual JSBSim initialization and fixed-step dynamics, shared with Sandbox. |
| Terrain contact rule | Shared reference-point contact threshold; validation supplies a controlled test surface. |
| Recording and sampling | Fixed 120 Hz engine run, sampled for replay; pure sampling supports pause, seek and playback speed. |
| Replay presentation | Existing aircraft/camera/director views, readouts, transport and expected-result note. |
| Crash presentation | Shared modal/reset behavior for Sandbox and validation, with one randomized message per collision. |
| Automated checks | Numeric invariants and actual browser interaction through the same UI. |

Scenario metadata and input schedules belong to the registry. Adding a physics
scenario should not require another branch in the replay renderer or flight
engine. Keep the renderer responsible for displaying state. The original synthetic
figure eight remains available alongside real-engine scenarios.

## Current selectable options

**Routes** contains Figure eight and Straight line (a trimmed C172 flight).
**Feature enhancements** contains idle power, full power, right-bank input, and
terrain contact/crash/reset, and calibrated controller roll. The controller scenario uses the same normalization as live Gamepad input, but cannot establish hardware connectivity. Each physics scenario lasts 12 seconds. Power and
control changes begin at 2 seconds, giving a short baseline for comparison.

Physics recordings use the actual bundled C172/JSBSim engine at 120 Hz. The flat,
visible validation surface is explicitly labeled at 1000 m WGS84, with an initial
flight height of 1100 m. It is a controlled test deck above the local terrain,
independent of online ground sampling. Crash detection shares the sandbox's
contact rule. Online sampling, stale responses and unavailable terrain have
separate automated tests and a browser fixture test using real Cesium terrain
heightmap decoding.

UI evidence helps compare observable behavior; it does not establish aerodynamic
accuracy or prove all integration paths. Keep those limits visible in the scenario
notes and handoff. Random crash text is presentation only; it does not change the
recorded trajectory or make physics checks nondeterministic.

## Adding the next feature

1. Add an entry to the registry with its group, expected observation and control
   schedule. Reuse the existing adapters and state contract.
2. Add a meaningful automated assertion about its behavior, using the actual
   engine when dynamics are involved. Internal edge-case assertions can support
   one visual scenario; they do not each need a duplicate dropdown option.
3. Exercise it through the browser test: select, observe, pause, seek, restart,
   and verify recovery/failure where relevant.
4. Update the handoff with exact results and the limits of the visual proxy.

Browser reproduction:

```sh
node scripts/validate-replay-browser.mjs http://127.0.0.1:53145 production
node scripts/validate-terrain-browser.mjs http://127.0.0.1:53145 production
```

Use a running Vite dev/preview origin; the second argument labels screenshot
artifacts. `CHROME_PATH` and `FLIGHT_EVIDENCE_DIR` work as in the other browser suite.
