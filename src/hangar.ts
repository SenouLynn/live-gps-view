import * as C from 'cesium';
import { aircraftModels, type AircraftModel } from './aircraftModels';
import { physicsAircraft } from './physicsAircraft';
const get = (id:string)=>document.getElementById(id)!;
export function setupHangar() {
  const dialog=get('hangar-dialog') as HTMLDialogElement;
  let preview:C.Viewer|undefined, entity:C.Entity|undefined, selected:AircraftModel=aircraftModels[0];
  let loadingAbort:AbortController|undefined;
  const frameTimers=new Set<ReturnType<typeof setTimeout>>();
  let physicsView=false;
  let epoch=0, spinning=true, angle=0, last=performance.now();
  const anchor=C.Cartesian3.fromDegrees(0,0,1000);
  const anchorFrame=C.Transforms.eastNorthUpToFixedFrame(anchor);
  function orientation() { return C.Transforms.headingPitchRollQuaternion(anchor,new C.HeadingPitchRoll(angle,0,0)); }
  function resetCamera(){
    if(!preview)return;
    preview.camera.lookAtTransform(anchorFrame,new C.Cartesian3(selected.radius*2.6,-selected.radius*2.6,selected.radius*1.6));
  }
  function dispose(){epoch++;loadingAbort?.abort();for(const timer of frameTimers)clearTimeout(timer);frameTimers.clear();if(preview&&!preview.isDestroyed())preview.destroy();preview=undefined;entity=undefined;}
  async function select(model:AircraftModel){
    if(!preview)return;
    loadingAbort?.abort();loadingAbort=new AbortController();
    const signal=loadingAbort.signal;
    const current=++epoch;selected=model;angle=0;
    preview.entities.removeAll();
    const configured=physicsView?physicsAircraft.find(asset=>asset.visualModelId===model.id):undefined;
    get('hangar-name').textContent=configured?.name??model.name;
    get('hangar-family').textContent=configured?`${configured.engine} · configured flight model · ${configured.initialAirspeedKt} kt start`:model.family;
    const source=get('hangar-source') as HTMLAnchorElement;source.href=model.source;source.textContent=`${model.creator} · original model`;
    get('hangar-status').textContent='Loading 3D model…';
    for(const button of Array.from(get('hangar-catalog').querySelectorAll('button')))button.setAttribute('aria-pressed',String(button.dataset.model===model.id));
    entity=preview.entities.add({position:anchor,orientation:orientation(),model:{uri:`/models/${model.file}`,scale:1,minimumPixelSize:0,runAnimations:true,imageBasedLightingFactor:new C.Cartesian2(1,1)}});
    resetCamera();
    try{
      // Resolve only a complete load; timeout keeps a broken asset from looking like an endless spinner.
      const response=await fetch(`/models/${model.file}`,{signal});if(!response.ok)throw new Error('Model missing');
      await response.arrayBuffer();
      if(current!==epoch||!preview)return;
      let timer:ReturnType<typeof setTimeout>|undefined;
      try {
        const framed=await Promise.race([preview.zoomTo(entity,new C.HeadingPitchRange(C.Math.toRadians(35),C.Math.toRadians(-20),selected.radius*4)),new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),15000);frameTimers.add(timer);})]);
        if(current===epoch&&preview) { preview.camera.lookAtTransform(anchorFrame);get('hangar-status').textContent=framed?'Drag to orbit · scroll to zoom · right-drag to pan':'Model could not be framed · try another aircraft or Reset view'; }
      } finally{clearTimeout(timer);if(timer)frameTimers.delete(timer);}
    }catch{if(current===epoch)get('hangar-status').textContent='Model unavailable · try another aircraft';}
  }
  function catalog(models: readonly AircraftModel[]) {
  get('hangar-catalog').replaceChildren();
  for(const model of models){
    const button=document.createElement('button');button.type='button';button.dataset.model=model.id;button.textContent=physicsView?physicsAircraft.find(asset=>asset.visualModelId===model.id)!.name:model.name;button.setAttribute('aria-pressed','false');button.onclick=()=>{void select(model);};get('hangar-catalog').append(button);
  }
  }
  let useAircraft:(()=>void)|undefined;
  function open(physics = false, onUse?:()=>void) {
    if(dialog.open)return;
    useAircraft=onUse;physicsView=physics;
    const models=physics ? aircraftModels.filter(model=>physicsAircraft.some(asset=>asset.visualModelId===model.id)) : aircraftModels;
    selected=models[0]; catalog(models);
    get('hangar-title').textContent=physics?'Physics aircraft hangar':'3D hangar';
    get('hangar-subtitle').textContent=physics?'Configured flight dynamics · 1 aircraft · C172 loads automatically':'Aircraft library';
    get('hangar-use').hidden=!physics;
    dialog.showModal();
    try {
      preview=new C.Viewer('hangar-stage',{globe:false,baseLayer:false,skyBox:false,skyAtmosphere:false,animation:false,timeline:false,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,selectionIndicator:false,infoBox:false});
      if(preview.scene.sun)preview.scene.sun.show=false;
      if(preview.scene.moon)preview.scene.moon.show=false;
      preview.scene.backgroundColor=C.Color.fromCssColorString('#101c26');
      preview.scene.light=new C.DirectionalLight({direction:new C.Cartesian3(-1,-1,-2),intensity:2});
      preview.scene.screenSpaceCameraController.minimumZoomDistance=.5;
      last=performance.now();
      preview.scene.preUpdate.addEventListener(()=>{const now=performance.now(),dt=Math.min(.1,(now-last)/1000);last=now;if(spinning&&entity){angle+=dt*.2;entity.orientation=new C.ConstantProperty(orientation());}});
      void select(selected);
    } catch {dispose();get('hangar-status').textContent='3D preview unavailable · check WebGL support';}
  }
  get('hangar-open').onclick=()=>open();
  get('hangar-use').onclick=()=>{useAircraft?.();dialog.close();};
  get('hangar-close').onclick=()=>dialog.close();dialog.addEventListener('close',dispose);
  get('hangar-reset').onclick=resetCamera;
  get('hangar-spin').onclick=()=>{spinning=!spinning;get('hangar-spin').textContent=spinning?'Pause rotation':'Rotate';};
  window.addEventListener('pagehide',dispose);
  return { openPhysics: (onUse:()=>void)=>open(true,onUse) };
}
