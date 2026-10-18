/** Lightweight demo kinematics, not an aerodynamic or autopilot model. */
export const sandboxGroundSpeedMps = 50;
export interface SandboxState {
  latitudeDeg: number; longitudeDeg: number; ellipsoidHeightM: number;
  headingDeg: number; pitchDeg: number; rollDeg: number; timeSeconds: number;
  commandPitchDeg: number; commandBankDeg: number;
}
export interface SandboxInput { pitch: number; bank: number }
export function initialSandboxState(): SandboxState {
  return {latitudeDeg:44.4759,longitudeDeg:-73.202,ellipsoidHeightM:600,headingDeg:45,pitchDeg:0,rollDeg:0,commandPitchDeg:0,commandBankDeg:0,timeSeconds:0};
}
const clamp = (n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
export function stepSandbox(state: SandboxState, input: SandboxInput, dt: number): SandboxState {
  const rad=Math.PI/180;
  // Held keys change the command at a bounded rate, rather than requesting full deflection.
  const commandPitchDeg=input.pitch ? clamp(state.commandPitchDeg+clamp(input.pitch,-1,1)*10*dt,-25,25)
    : state.commandPitchDeg*Math.exp(-dt/.35);
  const commandBankDeg=input.bank ? clamp(state.commandBankDeg+clamp(input.bank,-1,1)*15*dt,-40,40)
    : state.commandBankDeg*Math.exp(-dt/.35);
  const pitchDeg=state.pitchDeg+(commandPitchDeg-state.pitchDeg)*(1-Math.exp(-dt/ .38));
  const rollDeg=state.rollDeg+(commandBankDeg-state.rollDeg)*(1-Math.exp(-dt/ .46));
  const turnRate=9.80665*Math.tan(rollDeg*rad)/sandboxGroundSpeedMps;
  const headingDeg=(state.headingDeg+turnRate*dt/rad+360)%360;
  const midHeading=(state.headingDeg*rad+turnRate*dt/2);
  const height=state.ellipsoidHeightM+sandboxGroundSpeedMps*Math.tan(pitchDeg*rad)*dt;
  return {latitudeDeg:state.latitudeDeg+sandboxGroundSpeedMps*Math.cos(midHeading)*dt/111320,
    longitudeDeg:state.longitudeDeg+sandboxGroundSpeedMps*Math.sin(midHeading)*dt/(111320*Math.cos(state.latitudeDeg*rad)),
    ellipsoidHeightM:clamp(height,100,4000),headingDeg,
    commandPitchDeg,commandBankDeg,pitchDeg:height<100||height>4000?0:pitchDeg,rollDeg,timeSeconds:state.timeSeconds+dt};
}

/** Existing assisted model behind the same lifecycle as a future dynamics engine. */
export function createSandboxEngine(initial: SandboxState): import('./flightSimulation.ts').FlightEngine<SandboxState, SandboxInput> {
  let state = { ...initial };
  return {
    reset(next) { state = { ...next }; },
    advance(input, dtSeconds) { state = stepSandbox(state, input, dtSeconds); },
    snapshot() { return { ...state }; },
  };
}
