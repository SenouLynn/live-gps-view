export const durationSeconds = 120;
// Invented route above Marin Headlands. Time-based sampling stays independent of render rate.
const route = [
  { t: 0, lat: 37.826, lon: -122.532 },
  { t: 30, lat: 37.829, lon: -122.520 },
  { t: 60, lat: 37.832, lon: -122.508 },
  { t: 90, lat: 37.835, lon: -122.496 },
  { t: 120, lat: 37.838, lon: -122.484 },
];
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180;
  const a = lat1 * rad, b = lat2 * rad, d = (lon2 - lon1) * rad;
  return (Math.atan2(Math.sin(d) * Math.cos(b), Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(d)) / rad + 360) % 360;
}
export function sampleRoute(seconds: number, height: number) {
  const t = Math.max(0, Math.min(durationSeconds, seconds));
  const index = Math.min(route.length - 2, Math.floor(t / 30));
  const a = route[index], b = route[index + 1], f = (t - a.t) / (b.t - a.t);
  return { latitudeDeg: a.lat + (b.lat - a.lat) * f, longitudeDeg: a.lon + (b.lon - a.lon) * f,
    ellipsoidHeightM: height, headingDeg: bearing(a.lat, a.lon, b.lat, b.lon) };
}
