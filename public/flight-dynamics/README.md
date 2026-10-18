# Flight dynamics assets

Cessna 172P flight model files copied unchanged from JSBSim v1.2.4, commit
`e07a7d810d4f1048039d42545d008b8a998636fa`:
https://github.com/JSBSim-Team/jsbsim/tree/e07a7d810d4f1048039d42545d008b8a998636fa

`manifest.json` lists the source files and SHA-256 hashes checked by the real-engine tests.
`COPYING` is the upstream GNU Lesser General Public License 2.1 text. Original
XML headers/notes are retained, including the C172 model's educational/entertainment
scope, manufacturer disclaimer, and statement that the simulation model is not to
be sold. Refer to each file's own notices; this project does not relicense them.

The WASM runtime and SDK are supplied by the exact npm dependency
`@0x62/jsbsim-wasm@1.2.4-beta.4`:
https://github.com/0x62/jsbsim-wasm
The wrapper is MIT licensed; JSBSim itself retains its upstream LGPL license.
Upstream JSBSim source for rebuilding the runtime is linked above; wrapper build
instructions and Emscripten compatibility patches are in the wrapper repository.

The 3D C172 is a separate visual asset; see `/models/README.md` for its source,
creator and CC BY 4.0 attribution. Choosing a visual mesh does not configure a
physics model. The physics catalog lives in `src/physicsAircraft.ts`.

This milestone uses calm air and trimmed airborne initialization at 100 kt.
The application detects bare-earth terrain contact and freezes the aircraft with a
crash overlay and Reset button. This simple reference-point clearance check is
separate from JSBSim landing gear: no bounce, runway operations, buildings or trees.
Missing terrain is reported as collision unavailable. Takeoff/landing, aircraft
systems UI, and persistent internal engine state are not implemented. Physics altitude is JSBSim's geodetic height
above its WGS84 ellipsoid; it is not an MSL altitude.
