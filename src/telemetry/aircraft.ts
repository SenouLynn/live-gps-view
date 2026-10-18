export interface Aircraft {
  id: string; callsign: string; lat: number; lon: number; height: number;
  observed: number; type?: string; course?: number; speed?: number; climb: number;
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function parseAircraft(payload: unknown): Aircraft[] {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid aircraft response');
  const data = payload as Record<string, unknown>;
  if (!finite(data.now) || !Array.isArray(data.ac)) throw new Error('Invalid aircraft response');
  const now = data.now > 1e10 ? data.now : data.now * 1000;
  const result = new Map<string, Aircraft>();
  for (const row of data.ac.slice(0, 1000)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    // Barometric altitude is not interchangeable with geometric height. Skip rather than invent a datum.
    if (typeof r.hex !== 'string' || !/^~?[0-9a-f]{6}$/i.test(r.hex) || !finite(r.lat) || !finite(r.lon) || Math.abs(r.lat) > 90 || Math.abs(r.lon) > 180 || r.alt_baro === 'ground' || !finite(r.alt_geom) || !finite(r.seen_pos) || r.seen_pos < 0 || r.seen_pos > 30) continue;
    const id = r.hex.toLowerCase();
    result.set(id, { id, callsign: typeof r.flight === 'string' && r.flight.trim() ? r.flight.trim().slice(0, 16) : id,
      type: typeof r.t === 'string' ? r.t.trim().toUpperCase() : undefined,
      lat: r.lat, lon: r.lon, height: r.alt_geom * 0.3048, observed: now - r.seen_pos * 1000,
      course: finite(r.track) && r.track >= 0 && r.track < 360 ? r.track : undefined,
      speed: finite(r.gs) && r.gs >= 0 && r.gs < 2000 ? r.gs * 0.514444 : undefined,
      climb: finite(r.geom_rate) ? r.geom_rate * 0.00508 : 0,
    });
  }
  return [...result.values()].slice(0, 250);
}
/** Prediction stops after ten seconds; positions disappear after thirty seconds. */
export function aircraftPose(aircraft: Aircraft, now: number) {
  const age = (now - aircraft.observed) / 1000;
  if (age < -1 || age > 30) return undefined;
  const predicted = age > 0 && aircraft.course !== undefined && aircraft.speed !== undefined;
  const seconds = Math.max(0, Math.min(10, age));
  const distance = (aircraft.speed ?? 0) * seconds / 6371008.8;
  const rad = Math.PI / 180, lat = aircraft.lat * rad, lon = aircraft.lon * rad, bearing = (aircraft.course ?? 0) * rad;
  const moving = aircraft.speed !== undefined && aircraft.course !== undefined;
  const destLat = moving ? Math.asin(Math.sin(lat) * Math.cos(distance) + Math.cos(lat) * Math.sin(distance) * Math.cos(bearing)) : lat;
  const destLon = moving ? lon + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat), Math.cos(distance) - Math.sin(lat) * Math.sin(destLat)) : lon;
  return { lat: destLat / rad, lon: ((destLon / rad + 540) % 360) - 180,
    height: aircraft.height + (moving ? aircraft.climb * seconds : 0), age,
    state: age > 10 ? 'HELD' : predicted ? 'PREDICTED' : 'REPORTED' };
}

/** Resolve a usable follow pose before the UI takes camera ownership. */
export function aircraftFollowPose(aircraft: Aircraft | undefined, now: number, fallbackHeading: number) {
  if (!aircraft) return undefined;
  const pose = aircraftPose(aircraft, now);
  if (!pose) return undefined;
  return { ...pose, heading: aircraft.course ?? fallbackHeading, headingInferred: aircraft.course === undefined };
}
