export const durationSeconds = 120;
// Invented figure eight above Burlington, Vermont; one complete circuit in two minutes.
const center = { lat: 44.4759, lon: -73.202 };
const metersPerDegree = 111_320;
const eastRadiusM = 800, northRadiusM = 400, climbM = 120;
// Sixteen-second ramps with zero vertical speed and acceleration at either end.
function altitudeRamp(seconds: number, start: number) {
  const u = Math.max(0, Math.min(1, (seconds - start) / 16));
  return {
    fraction: u * u * u * (10 + u * (-15 + 6 * u)),
    rate: 30 * u * u * (1 - u) * (1 - u) / 16,
  };
}
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180;
  const a = lat1 * rad, b = lat2 * rad, d = (lon2 - lon1) * rad;
  return (Math.atan2(Math.sin(d) * Math.cos(b), Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(d)) / rad + 360) % 360;
}
export function sampleRoute(seconds: number, height: number) {
  const t = Math.max(0, Math.min(durationSeconds, seconds));
  const phase = t / durationSeconds * 2 * Math.PI;
  const rate = 2 * Math.PI / durationSeconds;
  // Gerono lemniscate: east = A sin(t), north = B sin(2t).
  const eastVelocity = eastRadiusM * Math.cos(phase) * rate;
  const northVelocity = 2 * northRadiusM * Math.cos(2 * phase) * rate;
  const climb = altitudeRamp(t, 22), descent = altitudeRamp(t, 82);
  const heightOffsetM = climbM * (climb.fraction - descent.fraction);
  const verticalVelocity = climbM * (climb.rate - descent.rate);
  const horizontalSpeed = Math.hypot(eastVelocity, northVelocity);
  const eastAcceleration = -eastRadiusM * Math.sin(phase) * rate * rate;
  const northAcceleration = -4 * northRadiusM * Math.sin(2 * phase) * rate * rate;
  // Clockwise heading rate is positive: bank right for a right turn.
  const headingRate = (northVelocity * eastAcceleration - eastVelocity * northAcceleration) / (horizontalSpeed * horizontalSpeed);
  const bankDeg = Math.atan2(horizontalSpeed * headingRate, 9.80665) * 180 / Math.PI;
  return {
    latitudeDeg: center.lat + northRadiusM * Math.sin(2 * phase) / metersPerDegree,
    longitudeDeg: center.lon + eastRadiusM * Math.sin(phase) / (metersPerDegree * Math.cos(center.lat * Math.PI / 180)),
    ellipsoidHeightM: height + heightOffsetM,
    heightOffsetM,
    headingDeg: (Math.atan2(eastVelocity, northVelocity) * 180 / Math.PI + 360) % 360,
    pitchDeg: Math.atan2(verticalVelocity, horizontalSpeed) * 180 / Math.PI,
    // Synthetic coordinated-turn bank, limited for a gentle demo.
    rollDeg: Math.max(-35, Math.min(35, bankDeg)),
  };
}
