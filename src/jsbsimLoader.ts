import { JSBSimSdk } from '@0x62/jsbsim-wasm';
import moduleUrl from '@0x62/jsbsim-wasm/wasm/module?url';
import binaryUrl from '@0x62/jsbsim-wasm/wasm/binary?url';
import { createJsbsimEngine } from './jsbsimEngine.ts';
import { defaultPhysicsAircraft } from './physicsAircraft.ts';
import type { SandboxState } from './sandboxFlight.ts';

const assetPaths = defaultPhysicsAircraft.assets;
export async function loadAircraftEngine(start: SandboxState) {
  // Fetch failure must be explicit; the existing assisted sandbox remains selectable.
  const assets = await Promise.all(assetPaths.map(async path => {
    const response = await fetch(`${import.meta.env.BASE_URL}flight-dynamics/${path}`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`C172 asset unavailable (${response.status}).`);
    const xml = await response.text();
    if (!xml.trimStart().startsWith('<?xml')) throw new Error('C172 asset response is not XML.');
    return { path, xml };
  }));
  const sdk = await JSBSimSdk.create({
    moduleUrl: new URL(moduleUrl, location.href), wasmUrl: new URL(binaryUrl, location.href), log: { console: false },
  });
  try {
    sdk.setDebugLevel(0);
    sdk.disableOutput();
    for (const { path, xml } of assets) sdk.writeDataFile(path, xml);
    if (!sdk.loadModel(defaultPhysicsAircraft.id)) throw new Error('Unable to load the C172 aircraft model.');
  } catch (error) { sdk.destroy(); throw error; }
  return createJsbsimEngine(sdk, start);
}
