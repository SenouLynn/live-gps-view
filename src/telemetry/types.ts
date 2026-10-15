/** Draft v1 boundary: transport and renderer independent. All numbers finite. */
export type Altitude =
  | { meters: number; reference: 'wgs84-ellipsoid' }
  | { meters: number; reference: 'msl'; geoidModel: string }
  | { meters: number; reference: 'above-home'; homeAltitude: AbsoluteAltitude }
  | { meters: number; reference: 'agl' };

export type AbsoluteAltitude = Extract<Altitude, { reference: 'wgs84-ellipsoid' | 'msl' }>;

export interface PositionSample {
  version: 1;
  vehicleId: string;
  /** Changes on source reboot, replay restart, or clock discontinuity. */
  sessionId: string;
  /** Source sample time mapped into a session-relative monotonic timeline. */
  timeMs: number;
  /** Receiver monotonic time in the consuming process; not sent over the wire. */
  receivedAtMs?: number;
  latitudeDeg: number; // [-90, 90]
  longitudeDeg: number; // [-180, 180]
  altitude: Altitude;
  /** True-north clockwise course of movement; distinct from vehicle heading. */
  courseDeg?: number; // [0, 360)
  velocityNedMps?: { north: number; east: number; down: number };
  /** Optional independent attitude sample, with its own freshness timestamp.
   * Aerospace body FRD relative to local NED; intrinsic ZYX Euler angles.
   * yaw is clockwise from true north, pitch positive nose up, roll right wing down.
   */
  attitude?: { timeMs: number; yawDeg: number; pitchDeg: number; rollDeg: number };
  provenance: 'fixture' | 'replay' | 'live';
}

export type SourceEvent =
  | { type: 'sample'; sample: PositionSample }
  | { type: 'status'; state: 'connecting' | 'connected' | 'disconnected' | 'error'; message?: string };

/** Callback accommodates in-memory replay, WebSocket, SSE, and native bridges.
 * Implementations release timers/sockets on abort or unsubscribe.
 */
export interface TelemetrySource {
  subscribe(onEvent: (event: SourceEvent) => void, signal?: AbortSignal): () => void;
}

/** Renderer boundary after datum resolution and motion sampling.
 * AGL/home-relative input must be resolved before reaching this interface.
 */
export interface CameraPose {
  latitudeDeg: number;
  longitudeDeg: number;
  ellipsoidHeightM: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  orientationMode: 'course' | 'attitude';
  freshness: 'fresh' | 'predicted' | 'stale';
}
