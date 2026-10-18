import * as C from 'cesium';
import { parseWind, windArrowRotation, weatherFresh } from './weatherData';
import { refreshLayer } from './refresh';
const el = (id: string) => document.getElementById(id)!;
const check = (id: string) => el(id) as HTMLInputElement;
const SVG = 'http://www.w3.org/2000/svg';
const timeLabel = (ms: number) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', timeZoneName:'short' });
export function setupWeather(viewer: C.Viewer) {
  let courseDeg = 0, drawnCourse = NaN;
  const mapLayer = el('weather-map-layer');
  function orientMap() {
    if (Number.isFinite(drawnCourse) && Math.abs(((courseDeg - drawnCourse + 540) % 360) - 180) < .15) return;
    drawnCourse = courseDeg;
    mapLayer.style.transform = `rotate(${-courseDeg}deg)`;
    for (const label of Array.from(el('wind-field').querySelectorAll('text'))) {
      label.setAttribute('transform', `rotate(${courseDeg} 10 20)`);
    }
    el('weather-course').textContent = `COURSE UP · ${Math.round(courseDeg).toString().padStart(3,'0')}°`;
  }
  let lat = 44.5, lon = -73.2, windTime = 0, radarTime = 0;
  const urls = new Map<string,string>();
  const query = () => new URLSearchParams({lat:String(lat),lon:String(lon)});
  function release(id: string) { const old=urls.get(id); if(old) URL.revokeObjectURL(old); urls.delete(id); (el(id) as HTMLImageElement).removeAttribute('src'); }
  async function json(path: string, signal: AbortSignal) {
    const response = await fetch(`/api/weather/${path}?${query()}`, {signal});
    if(!response.ok) throw new Error('Weather unavailable');
    return response.json();
  }
  async function image(id: string, path: string, signal: AbortSignal, time?:string) {
    const q=query(); if(time) q.set('time',time);
    const response=await fetch(`/api/weather/${path}?${q}`,{signal});
    if(!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Image unavailable');
    const blob=await response.blob(); signal.throwIfAborted();
    const url=URL.createObjectURL(blob), probe=new Image(); probe.src=url;
    try { await probe.decode(); signal.throwIfAborted(); } catch(e) { URL.revokeObjectURL(url); throw e; }
    release(id); urls.set(id,url); (el(id) as HTMLImageElement).src=url;
  }
  const basemap=refreshLayer(300000,async signal=>{
    await image('weather-basemap','basemap',signal);
    el('map-status').textContent='Aerial basemap · course up · cross marks region center';
  },()=>{release('weather-basemap');el('map-status').textContent='Basemap unavailable · weather coordinates still shown';});
  const wind=refreshLayer(300000,async signal=>{
    const data=parseWind(await json('wind',signal)); signal.throwIfAborted();
    windTime=Math.min(...data.points.map(p=>p.time*1000));
    if(!weatherFresh(windTime,Date.now(),2*3600000)) throw new Error('Stale wind');
    const svg=el('wind-field'); svg.replaceChildren();
    for(const p of data.points){
      const x=(p.lon-(data.centerLon-.5))*300,y=((data.centerLat+.5)-p.lat)*300;
      const group=document.createElementNS(SVG,'g');group.setAttribute('transform',`translate(${x} ${y})`);
      const path=document.createElementNS(SVG,'path');path.setAttribute('d','M 0 13 L 0 -13 M -6 -5 L 0 -13 L 6 -5');
      path.setAttribute('transform',`rotate(${windArrowRotation(p.from)})`);
      group.append(path);
      const text=document.createElementNS(SVG,'text');text.setAttribute('x','10');text.setAttribute('y','20');text.textContent=`${p.speed.toFixed(1)}`;group.append(text);svg.append(group);
    }
    drawnCourse = NaN;
    orientMap();
    svg.removeAttribute('hidden');
    const center=data.points[4];
    el('wind-status').textContent=`GFS via Open-Meteo · 10 m AGL forecast · center ${center.speed.toFixed(1)} m/s from ${Math.round(center.from)}° · valid ${timeLabel(windTime)}`;
    el('wind-status').title='Model-derived field. Run issue time not supplied by this endpoint. Arrows point downwind; values are m/s.';
  },()=>{windTime=0;el('wind-field').replaceChildren();el('wind-status').textContent='Wind unavailable or stale · retry in 5 minutes or Refresh here';});
  const radar=refreshLayer(120000,async signal=>{
    const data=await json('radar-meta',signal);signal.throwIfAborted();
    const timestamp=Date.parse(data.observedAt);
    if(!weatherFresh(timestamp,Date.now(),20*60000)) throw new Error('Stale radar');
    // Publish the observation label only after its exact-time image has loaded.
    await image('radar-image','radar-image',signal,data.observedAt);
    radarTime=timestamp;
    el('radar-status').textContent=`NOAA MRMS observed ${timeLabel(timestamp)} · ~1 km reflectivity`;
    el('radar-status').title=data.observedAt;
    el('radar-image').hidden=false;
    try { await image('radar-legend','radar-legend',signal); } catch { if(!signal.aborted) el('legend-status').textContent='Legend unavailable'; }
  },()=>{radarTime=0;release('radar-image');el('radar-status').textContent='Radar unavailable, stale, or outside coverage · retry in 2 minutes or Refresh here';});
  function sync() {
    wind.stop();radar.stop();basemap.stop();
    windTime=0;radarTime=0;
    el('wind-field').replaceChildren();release('radar-image');release('radar-legend');release('weather-basemap');
    const windOn=check('wind-enabled').checked,radarOn=check('radar-enabled').checked;
    el('weather-card').hidden=!windOn&&!radarOn;
    el('radar-controls').hidden=!radarOn;
    const camera=viewer.camera.positionCartographic;
    lat=Math.round(C.Math.toDegrees(camera.latitude)*10)/10;lon=Math.round(C.Math.toDegrees(camera.longitude)*10)/10;
    el('weather-center').textContent=`${lat.toFixed(1)}°, ${lon.toFixed(1)}° · 1° × 1° region`;
    el('wind-status').textContent=windOn?'Loading GFS 10 m wind…':'Wind off';
    el('radar-status').textContent=radarOn?'Loading observed NOAA radar…':'Radar off';
    el('legend-status').textContent='Radar reflectivity (dBZ), not rainfall rate. Gaps do not mean clear weather.';
    if(windOn||radarOn) basemap.start();
    if(windOn)wind.start();if(radarOn)radar.start();
  }
  check('wind-enabled').onchange=sync;check('radar-enabled').onchange=sync;el('weather-refresh').onclick=sync;
  check('radar-opacity').oninput=()=>{el('radar-image').style.opacity=String(Number(check('radar-opacity').value)/100);};
  const staleTimer=setInterval(()=>{
    if(windTime&&!weatherFresh(windTime,Date.now(),2*3600000)){el('wind-field').replaceChildren();el('wind-status').textContent='Wind expired · awaiting fresh model data';windTime=0;}
    if(radarTime&&!weatherFresh(radarTime,Date.now(),20*60000)){release('radar-image');el('radar-status').textContent='Radar expired · awaiting fresh observation';radarTime=0;}
  },30000);
  window.addEventListener('pagehide',()=>{wind.stop();radar.stop();basemap.stop();clearInterval(staleTimer);for(const id of [...urls.keys()])release(id);});
  return {
    setCourse(degrees: number) {
      if (!Number.isFinite(degrees)) return;
      courseDeg = ((degrees % 360) + 360) % 360;
      if (!el('weather-card').hidden) orientMap();
    },
  };
}
