const root = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/';
export const airspaceSources = {
  sites: { service: 'Recreational_Flyer_Fixed_Sites', fields: 'OBJECTID,SITE_NAME,CEILING,UNIT,BOUNDARY,LAST_EDIT_DT' },
  ceilings: { service: 'FAA_UAS_FacilityMap_Data', fields: 'OBJECTID,CEILING,UNIT,MAP_EFF,LAST_EDIT,APT1_NAME,LATITUDE,LONGITUDE' },
  restrictions: { service: 'DoD_Mar_13', fields: 'OBJECTID,Facility,Base,Reason,Floor,Ceiling' },
};
export function airspaceProxy() {
  const cache = new Map();
  let cooldown = 0;
  const install = server => { server.middlewares.use('/api/airspace', async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const kind = url.searchParams.get('kind'), source = Object.hasOwn(airspaceSources, kind) ? airspaceSources[kind] : undefined;
    const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    if (!source || !url.searchParams.has('lat') || !url.searchParams.has('lon') || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 179.5) {
      res.writeHead(400); res.end('Unsupported region or layer'); return;
    }
    const centerLat = Math.round(lat * 10) / 10, centerLon = Math.round(lon * 10) / 10;
    const key = `${kind}/${centerLat}/${centerLon}`;
    const send = body => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(body); };
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < 300000) { send(cached.body); return; }
    if (Date.now() < cooldown) { res.writeHead(429, { 'Retry-After': String(Math.ceil((cooldown - Date.now()) / 1000)) }); res.end('FAA rate limit · retry later'); return; }
    try {
      const base = `${root}${source.service}/FeatureServer/0`;
      const signal = AbortSignal.timeout(20000);
      const metadataResponse = await fetch(`${base}?f=json`, { signal });
      const metadata = await metadataResponse.json();
      if (metadataResponse.status === 429 || metadata.error?.code === 429) { cooldown = Date.now() + 60000; throw new Error('Rate limited'); }
      if (!metadataResponse.ok || metadata.error) throw new Error('Metadata unavailable');
      const features = []; let partial = false;
      for (let offset = 0; offset < 4000; offset += 1000) {
        if (Date.now() < cooldown) throw new Error('Rate limited');
        const q = new URLSearchParams({ f: 'geojson', where: '1=1', geometryType: 'esriGeometryEnvelope',
          geometry: `${centerLon-.5},${centerLat-.5},${centerLon+.5},${centerLat+.5}`, inSR: '4326', outSR: '4326',
          spatialRel: 'esriSpatialRelIntersects', outFields: source.fields, returnGeometry: 'true', returnZ: 'false',
          orderByFields: 'OBJECTID ASC', resultOffset: String(offset), resultRecordCount: '1000' });
        const response = await fetch(`${base}/query?${q}`, { signal });
        const page = await response.json();
        if (response.status === 429 || page.error?.code === 429) { cooldown = Date.now() + 60000; throw new Error('Rate limited'); }
        if (!response.ok || page.error || page.type !== 'FeatureCollection' || !Array.isArray(page.features)) throw new Error('Invalid airspace response');
        features.push(...page.features);
        partial = !!(page.exceededTransferLimit || page.properties?.exceededTransferLimit) || page.features.length === 1000;
        if (!partial) break;
      }
      const body = JSON.stringify({ type: 'FeatureCollection', features, partial, retrievedAt: Date.now(),
        sourceUpdatedAt: metadata.editingInfo?.dataLastEditDate ?? metadata.editingInfo?.lastEditDate ?? null,
        center: { lat: centerLat, lon: centerLon }, source: base });
      if (cache.size >= 32) cache.delete(cache.keys().next().value);
      cache.set(key, { body, at: Date.now() }); send(body);
    } catch {
      if (Date.now() < cooldown) { res.writeHead(429, { 'Retry-After': '60' }); res.end('FAA rate limit · retry later'); }
      else { res.writeHead(502); res.end('FAA airspace layer unavailable'); }
    }
  }); };
  return { name: 'faa-airspace', configureServer: install, configurePreviewServer: install };
}
