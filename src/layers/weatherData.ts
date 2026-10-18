export interface WindPoint { lat: number; lon: number; time: number; speed: number; from: number }
export interface WindGrid { centerLat: number; centerLon: number; model: string; points: WindPoint[] }
export function parseWind(data: unknown): WindGrid {
  const d = data as WindGrid;
  if (!d || !Number.isFinite(d.centerLat) || !Number.isFinite(d.centerLon) || !Array.isArray(d.points) || d.points.length !== 9) throw new Error('Invalid wind field');
  if (!d.points.every(p => [p.lat,p.lon,p.time,p.speed,p.from].every(n=>typeof n==='number' && Number.isFinite(n)) && p.speed>=0 && p.from>=0 && p.from<=360 && Math.abs(p.lat)<=90 && Math.abs(p.lon)<=180 && p.time>0)) throw new Error('Incomplete wind field');
  return d;
}
export function windArrowRotation(fromDegrees: number) { return (fromDegrees + 180) % 360; }
export function weatherFresh(timestampMs: number, now: number, maxAgeMs: number) {
  return Number.isFinite(timestampMs) && now - timestampMs >= -300000 && now - timestampMs <= maxAgeMs;
}
