/** Submitted searches only: cached, bounded, and throttled for the public Photon service. */
export function locationProxy() {
  const cache = new Map();
  let nextRequest = 0, inFlight = false;
  const install = server => {
    server.middlewares.use('/api/locations/search', async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const query = (url.searchParams.get('q') || '').trim();
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      if (query.length < 2 || query.length > 160) { res.writeHead(400); res.end('Enter 2–160 characters'); return; }
      const key = query.toLowerCase();
      const send = body => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(body); };
      const saved = cache.get(key);
      if (saved && Date.now() - saved.at < 86400000) { send(saved.body); return; }
      if (inFlight || Date.now() < nextRequest) { res.writeHead(429, { 'Retry-After': '2' }); res.end('Please wait before searching again'); return; }
      inFlight = true; nextRequest = Date.now() + 1500;
      try {
        const base = process.env.PHOTON_SEARCH_URL || 'https://photon.komoot.io/api/';
        const upstream = new URL(base);
        upstream.search = new URLSearchParams({ q: query, limit: '5', lang: 'en' }).toString();
        const response = await fetch(upstream, { signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json', 'User-Agent': 'Synthetic-FPV-location-picker/0.1' } });
        if (response.status === 429) { nextRequest = Date.now() + 60000; res.writeHead(429, { 'Retry-After': '60' }); res.end('Search provider is rate limited'); return; }
        const payload = await response.json();
        if (!response.ok || !Array.isArray(payload.features)) throw new Error('Invalid search response');
        const results = payload.features.slice(0,5).flatMap(feature => {
          const point = feature.geometry?.coordinates, p = feature.properties;
          if (feature.geometry?.type !== 'Point' || !Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 85 || !p) return [];
          const label = [...new Set([p.name, p.city, p.state, p.country].filter(value => typeof value === 'string' && value))].join(', ');
          return label ? [{ label, lat: point[1], lon: point[0] }] : [];
        });
        const body = JSON.stringify({ results });
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        cache.set(key, { at: Date.now(), body }); send(body);
      } catch { res.writeHead(502); res.end('Place search unavailable'); }
      finally { inFlight = false; }
    });
  };
  return { name: 'location-search', configureServer: install, configurePreviewServer: install };
}
