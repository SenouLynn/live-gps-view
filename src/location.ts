export interface LocationPoint { lat: number; lon: number }
export function parseLocation(lat: unknown, lon: unknown): LocationPoint | undefined {
  if (!['string','number'].includes(typeof lat) || !['string','number'].includes(typeof lon) || String(lat).trim() === '' || String(lon).trim() === '') return;
  const latitude = Number(lat), longitude = Number(lon);
  if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 85 && Math.abs(longitude) <= 180)
    return { lat: latitude, lon: longitude };
}
export const locationZoomHeight = (height: number, factor: number) => Math.max(200, Math.min(25000000, height * factor));
