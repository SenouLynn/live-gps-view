const RADAR = 'https://nowcoast.noaa.gov/geoserver/observations/weather_radar/ows';
const LAYER = 'conus_base_reflectivity_mosaic';
export function radarTime(xml) {
  const start = xml.indexOf(`<Name>${LAYER}</Name>`);
  if (start < 0) throw new Error('Radar layer missing');
  const section = xml.slice(start, xml.indexOf('</Layer>', start));
  const time = section.match(/<Extent\b[^>]*name="time"[^>]*default="([^"]+)"/)?.[1];
  if (!time || !Number.isFinite(Date.parse(time))) throw new Error('Radar time missing');
  return new Date(time).toISOString();
}
export function weatherProxy() {
  const cache = new Map();
  let metadata;
  const cooldowns = new Map();
  async function request(url) {
    const host = new URL(url).hostname;
    if (Date.now() < (cooldowns.get(host) ?? 0)) throw new Error('Upstream cooling down');
    const response = await fetch(url, { signal: AbortSignal.timeout(18000), headers: { 'User-Agent': 'live-gps-view/0.1', Accept: '*/*' } });
    if (!response.ok) {
      const seconds = Number(response.headers.get('retry-after'));
      cooldowns.set(host, Date.now() + Math.min(300000, Math.max(30000, Number.isFinite(seconds) ? seconds * 1000 : 30000)));
      throw new Error('Upstream failed');
    }
    return response;
  }
  const install = server => {
    server.middlewares.use('/api/weather', async (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      const url = new URL(req.url || '/', 'http://localhost');
      const path = url.pathname;
      const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
      if (!['/radar-meta','/radar-image','/wind','/basemap','/radar-legend'].includes(path) || !url.searchParams.has('lat') || !url.searchParams.has('lon') || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 84 || lon < -179 || lon > 179) {
        res.writeHead(400); res.end('Invalid weather request'); return;
      }
      const centerLat = Math.round(lat * 10) / 10, centerLon = Math.round(lon * 10) / 10;
      const bbox = [centerLon-.5, centerLat-.5, centerLon+.5, centerLat+.5].join(',');
      const requestedTime = url.searchParams.get('time');
      if (path === '/radar-image' && (!requestedTime || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(requestedTime) || !Number.isFinite(Date.parse(requestedTime)))) { res.writeHead(400); res.end('Invalid observation time'); return; }
      const key = `${path}/${centerLat}/${centerLon}/${requestedTime ?? ''}`;
      const entry = cache.get(key);
      const send = value => { res.writeHead(200, { 'Content-Type': value.type, 'Cache-Control': 'no-store' }); res.end(value.body); };
      if (entry && Date.now() - entry.at < (path === '/wind' ? 300000 : 120000)) { send(entry); return; }
      try {
        let value;
        if (path === '/radar-meta') {
          if (!metadata || Date.now() - metadata.at > 120000) {
            const response = await request(`${RADAR}?service=WMS&version=1.1.1&request=GetCapabilities`);
            metadata = { at: Date.now(), time: radarTime(await response.text()) };
          }
          value = { type: 'application/json', body: JSON.stringify({ observedAt: metadata.time, centerLat, centerLon }) };
        } else if (path === '/wind') {
          const points = [];
          for (const y of [-.3,0,.3]) for (const x of [-.3,0,.3]) points.push({ lat: centerLat+y, lon: centerLon+x });
          const query = new URLSearchParams({ latitude: points.map(p=>p.lat.toFixed(2)).join(','), longitude: points.map(p=>p.lon.toFixed(2)).join(','), current: 'wind_speed_10m,wind_direction_10m', wind_speed_unit: 'ms', models: 'gfs_seamless', timeformat: 'unixtime', timezone: 'GMT' });
          const response = await request(`https://api.open-meteo.com/v1/forecast?${query}`);
          const data = await response.json();
          if (!Array.isArray(data) || data.length !== 9) throw new Error('Invalid wind grid');
          value = { type: 'application/json', body: JSON.stringify({ centerLat, centerLon, model: 'GFS Seamless via Open-Meteo', points: data.map((d,i)=>({ ...points[i], time: d.current?.time, speed: d.current?.wind_speed_10m, from: d.current?.wind_direction_10m })) }) };
        } else {
          let target;
          if (path === '/basemap') {
            const q = new URLSearchParams({ bbox, bboxSR: '4326', imageSR: '4326', size: '512,512', format: 'jpg', f: 'image' });
            target = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?${q}`;
          } else if (path === '/radar-legend') {
            target = `${RADAR}?service=WMS&version=1.1.1&request=GetLegendGraphic&format=image/png&layer=${LAYER}&style=weather_radar_base_reflectivity`;
          } else {
            const q = new URLSearchParams({ service:'WMS',version:'1.1.1',request:'GetMap',layers:LAYER,styles:'weather_radar_base_reflectivity',srs:'EPSG:4326',bbox,width:'512',height:'512',format:'image/png',transparent:'true',time:requestedTime });
            target = `${RADAR}?${q}`;
          }
          const response = await request(target);
          const type = response.headers.get('content-type') ?? '';
          if (!type.startsWith('image/')) throw new Error('Invalid image response');
          const body = Buffer.from(await response.arrayBuffer());
          if (body.length > 5*1024*1024) throw new Error('Image too large');
          value = { type, body };
        }
        const stored = { ...value, at: Date.now() };
        if (cache.size >= 32) cache.delete(cache.keys().next().value);
        cache.set(key, stored); send(stored);
      } catch {
        res.writeHead(503, { 'Content-Type':'application/json', 'Retry-After':'60', 'Cache-Control':'no-store' });
        res.end(JSON.stringify({ error:'Weather product unavailable; retry later' }));
      }
    });
  };
  return { name:'weather-context', configureServer:install, configurePreviewServer:install };
}
