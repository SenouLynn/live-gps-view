import * as C from 'cesium';
import { satelliteClearOfEarth } from './gnssGeometry';
import { parseOrbits,orbitEcfMeters,lookAtOrbit,type Orbit,type Observer,type Constellation } from './gnss';
const el=(id:string)=>document.getElementById(id)!;
const check=(id:string)=>el(id) as HTMLInputElement;
const colors:Record<Constellation,string>={GPS:'#9aefbe',Galileo:'#86c8ff',GLONASS:'#ffca7c',BeiDou:'#e1a1ff',Other:'#b5bfc5'};
export function setupGnssScene(viewer:C.Viewer){
  const data=new C.CustomDataSource('GNSS predicted orbits');
  void viewer.dataSources.add(data);
  const entries=new Map<number,{orbit:Orbit;entity:C.Entity;pathsAt?:number}>();
  let controller:AbortController|undefined,timer:ReturnType<typeof setInterval>|undefined,orbitView=false,lastPaths=0;
  let observer:Observer={lat:44.4759,lon:-73.222,heightM:0};
  let restore:{position:C.Cartesian3;direction:C.Cartesian3;up:C.Cartesian3;inputs:boolean;scene:string}|undefined;
  function observerAtCamera(){const p=viewer.camera.positionCartographic;return{lat:C.Math.toDegrees(p.latitude),lon:C.Math.toDegrees(p.longitude),heightM:p.height};}
  function update(){
    if(!check('gnss-3d').checked)return;
    if(!orbitView)observer=observerAtCamera();
    else {
      el('source-badge').textContent='● ORBIT OVERVIEW';
      el('pose-note').textContent='GNSS overview · observer pinned at cockpit location';
    }
    const now=Date.now(),pathsDue=now-lastPaths>300000;
    const groups=new Set(Array.from(document.querySelectorAll<HTMLInputElement>('[data-gnss-group]:checked')).map(c=>c.value));
    const mask=Number(check('gnss-mask').value);
    let plotted=0,above=0;
    for(const entry of entries.values()){
      const {orbit,entity}=entry;
      const point=orbitEcfMeters(orbit,now),look=lookAtOrbit(orbit,observer,now);
      const eligible=groups.has(orbit.group)&&!!point;
      if(eligible&&look&&look.elevation>=mask)above++;
      entity.show=eligible&&(orbitView||!check('gnss-above-only').checked||!!look&&look.elevation>=mask);
      if(!point||!entity.show)continue;
      plotted++;
      const position=new C.Cartesian3(point.x,point.y,point.z);
      entity.position=new C.ConstantPositionProperty(position);
      // Distant labels remain screen symbols; never show satellites through the Earth.
      const clear=satelliteClearOfEarth(viewer.camera.positionWC,position);
      if(entity.point)entity.point.show=new C.ConstantProperty(clear);
      if(entity.label)entity.label.show=new C.ConstantProperty(clear&&check('gnss-labels').checked);
      if(entity.polyline)entity.polyline.show=new C.ConstantProperty(check('gnss-paths').checked);
      if((pathsDue||!entry.pathsAt)&&entity.polyline){
        const positions:C.Cartesian3[]=[];
        for(let minute=0;minute<=360;minute+=5){const p=orbitEcfMeters(orbit,now+minute*60000);if(p)positions.push(new C.Cartesian3(p.x,p.y,p.z));}
        entity.polyline.positions=new C.ConstantProperty(positions);entry.pathsAt=now;
      }
    }
    if(pathsDue)lastPaths=now;
    el('gnss-3d-status').textContent=`${plotted} orbital objects · ${above} above observer's ${mask}° mask · ${orbitView?'orbit overview':'camera sky'} · predicted, not receiver-tracked`;
  }
  function exitOverview(){
    if(!restore)return;
    viewer.camera.cancelFlight();viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
    viewer.camera.setView({destination:restore.position,orientation:{direction:restore.direction,up:restore.up}});
    viewer.scene.screenSpaceCameraController.enableInputs=restore.inputs;
    const source=el('scene-source') as HTMLSelectElement;source.value=restore.scene;source.dispatchEvent(new Event('change'));
    restore=undefined;orbitView=false;
    el('gnss-overview').textContent='Orbit overview';update();
  }
  el('gnss-overview').onclick=()=>{
    if(orbitView){exitOverview();return;}
    if(!check('gnss-3d').checked){check('gnss-3d').checked=true;void start();}
    observer=observerAtCamera();
    const source=el('scene-source') as HTMLSelectElement;
    restore={position:C.Cartesian3.clone(viewer.camera.positionWC),direction:C.Cartesian3.clone(viewer.camera.directionWC),up:C.Cartesian3.clone(viewer.camera.upWC),inputs:viewer.scene.screenSpaceCameraController.enableInputs,scene:source.value};
    orbitView=true;
    source.value='terrain';source.dispatchEvent(new Event('change'));
    viewer.camera.cancelFlight();viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
    viewer.camera.setView({destination:C.Cartesian3.fromDegrees(observer.lon,observer.lat,80000000),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});
    viewer.scene.screenSpaceCameraController.enableInputs=true;
    el('gnss-overview').textContent='Return to cockpit';lastPaths=0;update();
  };
  async function start(){
    controller?.abort();clearInterval(timer);data.entities.removeAll();entries.clear();lastPaths=0;
    controller=new AbortController();const signal=controller.signal;
    el('gnss-3d-status').textContent='Loading GNSS orbit catalog…';
    try{
      const response=await fetch('/api/gnss-orbits',{signal});if(!response.ok)throw new Error('Catalog unavailable');
      const payload=await response.json();signal.throwIfAborted();const orbits=parseOrbits(payload.elements);
      for(const orbit of orbits){
        const color=C.Color.fromCssColorString(colors[orbit.group]);
        const prn=orbit.name.match(/PRN\s*(\d+)/)?.[1];
        const entity=data.entities.add({id:`gnss-${orbit.id}`,name:orbit.name,
          point:{pixelSize:9,color,outlineColor:C.Color.BLACK,outlineWidth:1},
          label:{text:`${orbit.group} ${prn?'PRN '+prn:orbit.id}`,font:'11px monospace',fillColor:color,showBackground:true,pixelOffset:new C.Cartesian2(8,-8),horizontalOrigin:C.HorizontalOrigin.LEFT},
          polyline:{positions:[],width:1,material:color.withAlpha(.45),arcType:C.ArcType.NONE},
        });entries.set(orbit.id,{orbit,entity});
      }
      update();timer=setInterval(update,1000);
    }catch{if(!signal.aborted)el('gnss-3d-status').textContent='Orbital catalog unavailable · switch 3D satellites off/on to retry';}
  }
  check('gnss-3d').onchange=()=>{
    if(check('gnss-3d').checked)void start();
    else{exitOverview();controller?.abort();clearInterval(timer);data.entities.removeAll();entries.clear();el('gnss-3d-status').textContent='3D satellites off';}
  };
  for(const id of ['gnss-labels','gnss-paths','gnss-above-only'])check(id).onchange=()=>{lastPaths=0;update();};
  window.addEventListener('pagehide',()=>{controller?.abort();clearInterval(timer);});
  return{overview:()=>orbitView};
}
