/** A stateful engine boundary. Reading a pose must never advance engine time.
 * Adapters own unit/frame conversion; application poses use degrees and WGS84 meters.
 */
export interface FlightEngine<State, Input, InitialState = State> {
  reset(state: InitialState): void;
  advance(input: Input, dtSeconds: number): void;
  snapshot(): State;
}

/** Fixed simulation clock independent of rendering cadence. */
export function createFlightSimulation<State, Input, InitialState = State>(engine: FlightEngine<State, Input, InitialState>) {
  const stepSeconds = 1 / 120;
  let accumulator = 0;
  let previous = engine.snapshot();
  return {
    reset(state: InitialState) { engine.reset(state); accumulator = 0; previous = engine.snapshot(); },
    clearElapsed() { accumulator = 0; previous = engine.snapshot(); },
    advance(input: Input, elapsedSeconds: number) {
      if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return;
      accumulator += Math.min(elapsedSeconds, .1);
      while (accumulator + 1e-12 >= stepSeconds) {
        previous = engine.snapshot();
        engine.advance(input, stepSeconds);
        accumulator = Math.max(0, accumulator - stepSeconds);
      }
    },
    snapshot() { return engine.snapshot(); },
    render(interpolate: (a: State, b: State, fraction: number) => State) {
      return interpolate(previous, engine.snapshot(), accumulator / stepSeconds);
    },
    get remainderSeconds() { return accumulator; },
  };
}
