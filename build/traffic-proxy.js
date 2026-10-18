/** Fixed upstream and validated coordinates: this endpoint cannot proxy arbitrary URLs. */
export function trafficProxy() {
  let cache, cooldown = 0;
  const install = server => { server.middlewares.use('/api/traffic', async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
    if (!url.searchParams.has('lat') || !url.searchParams.has('lon') || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      res.writeHead(400); res.end('Invalid coordinates'); return;
    }
    const key = `${lat.toFixed(1)}/${lon.toFixed(1)}`;
    const send = body => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(body); };
    if (cache?.key === key && Date.now() - cache.at < 10000) { send(cache.body); return; }
    if (Date.now() < cooldown) { res.writeHead(429, { 'Retry-After': String(Math.ceil((cooldown - Date.now()) / 1000)) }); res.end(); return; }
    try {
      const upstream = await fetch(`https://api.adsb.lol/v2/point/${key}/50`, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'live-gps-view/0.1 (Cesium cockpit prototype)', Accept: 'application/json' } });
      if (!upstream.ok) {
        const delay = Number(upstream.headers.get('retry-after'));
        cooldown = Date.now() + Math.min(300000, Math.max(30000, Number.isFinite(delay) ? delay * 1000 : 30000));
        res.writeHead(upstream.status === 429 ? 429 : 502, { 'Retry-After': String(Math.ceil((cooldown - Date.now()) / 1000)) });
        res.end(); return;
      }
      const body = await upstream.text();
      cache = { key, body, at: Date.now() }; send(body);
    } catch { res.writeHead(502); res.end('Aircraft feed unavailable'); }
  }); };
  return { name: 'aircraft-traffic', configureServer: install, configurePreviewServer: install };
}
