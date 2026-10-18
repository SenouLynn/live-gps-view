import * as C from 'cesium';
import { parseOrbits,lookAtOrbit,skyPoint,orbitFresh,type Orbit,type Observer,type Constellation } from './gnss';
const $=(id:string)=>document.getElementById(id)!;
const input=(id:string)=>$(id) as HTMLInputElement;
const NS='http://www.w3.org/2000/svg';
const colors:Record<Constellation,string>={GPS:'#9aefbe',Galileo:'#86c8ff',GLONASS:'#ffca7c',BeiDou:'#e1a1ff',Other:'#b5bfc5'};
function svg(tag:string,attrs:Record<string,string>,parent:Element){const node=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,v);parent.append(node);return node;}
export function setupGnss(viewer:C.Viewer){
  const dialog=$('gnss-dialog') as HTMLDialogElement;
  let orbits:Orbit[]=[],observer:Observer={lat:44.4759,lon:-73.222,heightM:0},controller:AbortController|undefined,timer:ReturnType<typeof setInterval>|undefined,fetchedAt=0;
  function render(){
    if(!dialog.open)return;
    const now=Date.now(),mask=Number(input('gnss-mask').value);
    $('gnss-mask-value').textContent=`${mask}°`;
    const active=new Set(Array.from(dialog.querySelectorAll<HTMLInputElement>('[data-gnss-group]:checked')).map(c=>c.value));
    const root=$('gnss-plot');root.replaceChildren();
    svg('circle',{cx:'160',cy:'160',r:'130',fill:'#101f29',stroke:'#637b87'},root);
    for(const elevation of [30,60]){const r=(90-elevation)/90*130;svg('circle',{cx:'160',cy:'160',r:String(r),fill:'none',stroke:'#344c59'},root);svg('text',{x:'164',y:String(160-r+12),fill:'#96a9b3','font-size':'10'},root).textContent=`${elevation}°`;}
    svg('circle',{cx:'160',cy:'160',r:String((90-mask)/90*130),fill:'none',stroke:'#d8cf8e','stroke-dasharray':'4 4'},root);
    for(const[label,x,y]of [['N',160,16],['E',306,164],['S',160,311],['W',14,164]] as const)svg('text',{x:String(x),y:String(y),fill:'#e5f0ed','text-anchor':'middle','font-size':'13'},root).textContent=label;
    const rows=orbits.filter(o=>active.has(o.group)).map(orbit=>({orbit,look:lookAtOrbit(orbit,observer,now)})).filter(row=>row.look&&row.look.elevation>=0).sort((a,b)=>b.look!.elevation-a.look!.elevation);
    const above=rows.filter(r=>r.look!.elevation>=mask);
    $('gnss-count').textContent=`${above.length} above ${mask}° mask · ${rows.length} above horizon`;
    $('gnss-observer').textContent=`Observer ${observer.lat.toFixed(5)}°, ${observer.lon.toFixed(5)}° · ${observer.heightM.toFixed(0)} m WGS84`;
    $('gnss-clock').textContent=new Date(now).toLocaleString('en-US',{timeZone:'America/New_York',timeZoneName:'short'});
    const stale=orbits.filter(o=>!orbitFresh(o.epoch,now)).length;
    $('gnss-data-status').textContent=orbits.length?`CelesTrak · ${orbits.length} catalog objects · ${stale} excluded for old/future epochs · catalog fetched ${new Date(fetchedAt).toLocaleTimeString()} · receiver health unknown`:'No orbital catalog loaded';
    const table=$('gnss-rows');table.replaceChildren();
    for(const {orbit,look}of rows){
      if(!look)continue;
      const point=skyPoint(look.azimuth,look.elevation),color=colors[orbit.group];
      // Project future directions in observer coordinates; break trails at the horizon.
      let path='',drawing=false;
      for(let minute=0;minute<=60;minute+=5){const future=lookAtOrbit(orbit,observer,now+minute*60000);if(!future||future.elevation<0){drawing=false;continue;}const p=skyPoint(future.azimuth,future.elevation);path+=`${drawing?'L':'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)} `;drawing=true;}
      svg('path',{d:path,fill:'none',stroke:color,'stroke-opacity':'.4','stroke-width':'1','stroke-dasharray':'3 3'},root);
      const dot=svg('circle',{cx:String(point.x),cy:String(point.y),r:'4',fill:color,opacity:look.elevation>=mask?'1':'.3'},root);
      svg('title',{},dot).textContent=`${orbit.name} · ${orbit.group} · NORAD ${orbit.id}\nAz ${look.azimuth.toFixed(1)}° · El ${look.elevation.toFixed(1)}°\nOrbit epoch ${new Date(orbit.epoch).toISOString()}`;
      const name=orbit.name.match(/PRN\s*(\d+)/)?.[1]??String(orbit.id);
      svg('text',{x:String(point.x+6),y:String(point.y-5),fill:color,'font-size':'9',opacity:look.elevation>=mask?'1':'.4'},root).textContent=orbit.group==='GPS'?'G'+name:name;
      const next=lookAtOrbit(orbit,observer,now+15*60000);
      const tr=document.createElement('tr');
      for(const value of [orbit.group,orbit.name,`${look.azimuth.toFixed(0)}°`,`${look.elevation.toFixed(0)}°`,next?`${next.elevation>look.elevation?'↑':'↓'} ${next.elevation.toFixed(0)}°`:'—',look.elevation>=mask?'Above mask':'Low horizon']){const td=document.createElement('td');td.textContent=value;tr.append(td);}table.append(tr);
    }
    $('gnss-breakdown').textContent=(Object.keys(colors) as Constellation[]).map(g=>`${g}: ${above.filter(r=>r.orbit.group===g).length}`).join(' · ');
  }
  function fromCamera(){const p=viewer.camera.positionCartographic;input('gnss-lat').value=C.Math.toDegrees(p.latitude).toFixed(5);input('gnss-lon').value=C.Math.toDegrees(p.longitude).toFixed(5);input('gnss-height').value=p.height.toFixed(0);applyObserver();}
  function applyObserver(){const lat=Number(input('gnss-lat').value),lon=Number(input('gnss-lon').value),heightM=Number(input('gnss-height').value);if(![lat,lon,heightM].every(Number.isFinite)||Math.abs(lat)>90||Math.abs(lon)>180||heightM< -1000||heightM>100000||[input('gnss-lat'),input('gnss-lon'),input('gnss-height')].some(i=>i.value.trim()==='')){$('gnss-message').textContent='Enter valid latitude, longitude, and ellipsoid height.';return;}observer={lat,lon,heightM};$('gnss-message').textContent='Observer pinned · Refresh location to follow a new position';render();}
  async function load(){controller?.abort();controller=new AbortController();const signal=controller.signal;$('gnss-message').textContent='Loading public GNSS orbital elements…';try{const r=await fetch('/api/gnss-orbits',{signal});if(!r.ok)throw new Error('Unavailable');const data=await r.json();signal.throwIfAborted();const parsed=parseOrbits(data.elements);if(!Number.isFinite(data.fetchedAt))throw new Error('Invalid catalog time');orbits=parsed;fetchedAt=data.fetchedAt;$('gnss-message').textContent='Predicted geometry only · dashed paths show the next 60 minutes';render();}catch{if(!signal.aborted){$('gnss-message').textContent='Catalog unavailable · retry later; existing elements retain their epoch ages';render();}}}
  $('gnss-open').onclick=()=>{dialog.showModal();fromCamera();void load();timer=setInterval(render,5000);};
  $('gnss-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{controller?.abort();clearInterval(timer);});
  $('gnss-camera').onclick=fromCamera;$('gnss-apply').onclick=applyObserver;$('gnss-reload').onclick=()=>{void load();};
  input('gnss-mask').oninput=render;for(const item of Array.from(dialog.querySelectorAll<HTMLInputElement>('[data-gnss-group]'))){item.onchange=render;if(item.parentElement)item.parentElement.style.color=colors[item.value as Constellation];}
  window.addEventListener('pagehide',()=>{controller?.abort();clearInterval(timer);});
}
