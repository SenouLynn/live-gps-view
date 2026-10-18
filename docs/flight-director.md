# Demo flight director and replay integration

Choose **Flight director · demo** under Replay view. The amber command ring
previews heading and pitch two seconds ahead on the prescribed figure eight.
The green flight-path marker (circle, wings, tail) shows current course and climb
angle; fly it into the ring. A dashed steering line joins them when they are
apart, and the ring thickens when the marker is captured inside it. The aircraft
has a small synthetic yaw offset from course. Markers project world directions
1500 m ahead of the aircraft and roll with the rendered horizon. When a direction
falls outside the area not covered by the panels, or behind the camera, its
marker pins to that edge as a chevron pointing toward it. The top readout lists
path and command as bearing and pitch, the command's provenance, and steering
error (right/left, up/down). It shows "none current" when no command is
current. The fixed center reticle is hidden in this view.

The camera stays anchored behind the current aircraft position, using attitude
sampled 0.35 seconds earlier, 70% pitch and 30% roll. Sampling on replay time
makes pause, seek, restart and playback speed deterministic without a trailing
position jump. The distance and elevation controls still apply.

This is a presentation prototype, not a flight dynamics or control simulation.
Commands preview a known route; they do not cause the simulated vehicle motion.
Pitch reflects the synthetic altitude profile, rather than terrain-induced
vertical motion in AGL mode. No live input or SITL connection is enabled.

## Future source boundary

`DirectorSample` in `src/flightDirector.ts` separates motion, attitude and an
optional timestamped command with synthetic/recorded/live provenance. All angles
are degrees: heading and yaw clockwise from true north, pitch positive nose-up,
roll positive right-wing-down. Time is seconds on the resolved replay timeline.

A future SITL/blackbox adapter should pair resolved `PositionSample` data from
`src/telemetry/types.ts` with commands on the same session-relative timeline.
Resolve altitude datums first; derive flight-path angle from measured velocity
rather than nose pitch. Preserve measured yaw independently of course. Only map
actual heading/pitch setpoints to the command marker: raw stick inputs or rate
commands need their own explicit conversion/model, not a heading relabel.
Missing commands must stay absent; commands older than 0.5 seconds are hidden.
Validate finite values, time alignment, session changes and source freshness in
the adapter. The current `sampleDemoDirector` and `demoDirectorCamera` functions
are demo providers, to be replaced by timestamped source sampling and attitude
interpolation (quaternion interpolation across heading wrap). Keep camera behavior
separate from aircraft attitude and keep both on the same rendered motion sample.

## Keyboard sandbox

Select **Telemetry → Keyboard sandbox**, choose any **Camera view**, then click **Fly / focus keys** if the flight canvas
is not focused. Up raises the nose, Down lowers it; Left/Right command bank and a
coordinated heading change. Releasing keys eases pitch and bank to zero, retaining
the resulting heading and altitude. Space or the sandbox pause button pauses;
Reset flight restores Burlington at 600 m WGS84 with a 45° heading. Replay time,
speed and altitude controls are disabled while sandbox flight is active. Other
camera sources suspend the sandbox. Switching back preserves its state.

Ground speed is fixed at 50 m/s. Held keys build pitch commands at 10°/s and bank commands at 15°/s, capped at ±25° pitch and ±40° bank. Releasing smoothly recenters the commands; opposite input progressively reverses them. Aircraft attitude eases toward these commands, and the director reticle uses the same progressive setpoints.
Heading rate uses g tan(bank) / ground speed; vertical speed uses ground speed
× tan(pitch). This is intentionally simplified kinematics, without wind, stall,
energy management or aerodynamic forces. Physics uses 120 Hz fixed steps with a
fractional render sample. Frame gaps are capped at 0.1 seconds to avoid leaping
forward after a stall. The sandbox does not stop at the two-minute route limit.
Altitude is limited to 100–4000 m WGS84, without terrain collision or terrain
following. The sampled replay terrain profile is never reused for free flight.

In Flight director camera view, the command reticle uses held pitch input and a two-second heading prediction
from commanded bank. It is labeled synthetic and feeds the existing director
boundary; the overlay has no knowledge of keyboard events. Unlike prescribed
replay, sandbox input drives the kinematic state. Keys clear on blur, tab hiding,
source changes or pause; arrow events are captured only on the flight canvas.
