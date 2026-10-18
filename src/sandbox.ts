import * as C from 'cesium';
import type { setupCameraControls } from './cameraControls';
import type { setupHangar } from './hangar';
import { application, saveApplication } from './applicationState';
import { stepSandbox, sandboxGroundSpeedMps, createSandboxEngine, type SandboxState } from './sandboxFlight.ts';
import { createFlightSimulation } from './flightSimulation.ts';
import { interpolateAircraft, type AircraftEngine, type AircraftState, type AircraftControls } from './jsbsimEngine.ts';
import type { setupFollowCamera } from './followCamera';
import type { setupDirectorOverlay, DirectorSample } from './flightDirector';

export function setupSandbox(viewer:C.Viewer, follow:ReturnType<typeof setupFollowCamera>, overlay:ReturnType<typeof setupDirectorOverlay>, onCourse: (courseDeg:number)=>void, cameraControls: ReturnType<typeof setupCameraControls>, hangar:ReturnType<typeof setupHangar>) {
  const el=(id:string)=>document.getElementById(id)!;
  const canvas=viewer.scene.canvas; canvas.tabIndex=0;
  // Simple flight retains its own saved pose; physics never writes partial engine state into it.
  let state={...application.sandbox.current}, paused=application.sandbox.mode==='simple'&&application.sandbox.paused, active=false;
  const simulation=createFlightSimulation(createSandboxEngine(state));
  let aircraft:AircraftEngine|undefined;
  let lastAircraftPose:AircraftState|undefined;
  let physics:ReturnType<typeof createFlightSimulation<AircraftState, AircraftControls, SandboxState>>|undefined;
  let phase:'idle'|'loading'|'ready'|'failed'='idle', loadEpoch=0;
  let lastHud=-Infinity;
  const keys=new Set<string>();
  const mode=el('sandbox-mode') as HTMLSelectElement;
  mode.value=application.sandbox.mode;
  const throttle=el('physics-throttle') as HTMLInputElement;
  const trim=el('physics-trim') as HTMLInputElement;
  const physicsSelected=()=>mode.value==='physics';
  const clear=()=>{keys.clear();simulation.clearElapsed();if(phase==='ready')physics?.clearElapsed();};
  const pauseButton=el('sandbox-pause');
  const syncPause=()=>{pauseButton.textContent=paused?'Resume':'Pause';};
  function status(value:string){el('physics-status').textContent=value;el('physics-status').dataset.phase=phase;}
  function syncMode(){
    el('physics-controls').hidden=!physicsSelected();
    el('simple-flight-keys').hidden=physicsSelected();
    el('simple-flight-speed').hidden=physicsSelected();
  }
  function syncInputs(){
    el('physics-throttle-label').textContent=`${throttle.value}%`;
    el('physics-trim-label').textContent=`${Number(trim.value)>0?'+':''}${trim.value}`;
  }
  throttle.oninput=syncInputs;trim.oninput=syncInputs;
  function disposePhysics(){loadEpoch++;aircraft?.destroy();aircraft=undefined;physics=undefined;phase='idle';}
  async function initializePhysics(){
    disposePhysics();clear();lastAircraftPose=undefined;phase='loading';status('Loading C172 flight dynamics…');
    el('physics-readout').textContent='';
    const epoch=loadEpoch;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      const pending=import('./jsbsimLoader.ts').then(({loadAircraftEngine})=>loadAircraftEngine({...application.sandbox.start}));
      // A late result must dispose itself if mode, location, or timeout changed.
      void pending.then(engine=>{if(epoch!==loadEpoch)engine.destroy();},()=>{});
      const loaded=await Promise.race([pending,new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>reject(new Error('Loading timed out.')),30000);
      })]);
      if(epoch!==loadEpoch){loaded.destroy();return;}
      aircraft=loaded;physics=createFlightSimulation<AircraftState,AircraftControls,SandboxState>(loaded);lastAircraftPose=loaded.snapshot();phase='ready';
      throttle.value=String(Math.round(loaded.snapshot().throttle*10000)/100);
      trim.value='0';syncInputs();
      status('Cessna 172P ready · trimmed at 100 kt · reload starts a new flight');
    }catch(error){
      if(epoch!==loadEpoch)return;
      loadEpoch++;phase='failed';
      status(`C172 unavailable · ${error instanceof Error?error.message:'initialization failed'} Reset to retry, or choose Simple Free Flight.`);
    }finally{clearTimeout(timer);}
  }
  function resetPhysics(){
    clear();
    if(!aircraft||!physics){void initializePhysics();return;}
    try{
      physics.reset({...application.sandbox.start});
      lastAircraftPose=aircraft.snapshot();
      throttle.value=String(Math.round(aircraft.snapshot().throttle*10000)/100);trim.value='0';syncInputs();
      phase='ready';status('Cessna 172P ready · trimmed at 100 kt · reload starts a new flight');
    }catch{phase='failed';status('C172 reset failed · choose Simple Free Flight or Reset to retry.');disposePhysics();phase='failed';}
  }
  function togglePause(){
    paused=!paused;
    if(!physicsSelected())application.sandbox.paused=paused;
    saveApplication();clear();syncPause();
  }
  syncPause();syncMode();syncInputs();
  pauseButton.onclick=togglePause;
  el('sandbox-reset').onclick=()=>{
    if(physicsSelected())resetPhysics();
    else {state={...application.sandbox.start};application.sandbox.current=state;simulation.reset(state);application.sandbox.paused=false;}
    paused=false;saveApplication();clear();syncPause();canvas.focus();
  };
  mode.onchange=()=>{
    clear();disposePhysics();
    application.sandbox.mode=physicsSelected()?'physics':'simple';
    paused=physicsSelected()?false:application.sandbox.paused;
    syncMode();syncPause();saveApplication();lastHud=-Infinity;
    if(physicsSelected()&&active)void initializePhysics();
  };
  el('physics-hangar').onclick=()=>{clear();hangar.openPhysics(()=>{
    resetPhysics();paused=false;syncPause();lastHud=-Infinity;
  });};
  el('sandbox-fly').onclick=()=>canvas.focus();
  canvas.addEventListener('pointerdown',()=>{
    if(active&&!document.querySelector('dialog[open]'))canvas.focus({preventScroll:true});
  });
  el('replay-view').addEventListener('change',()=>{
    clear();
    requestAnimationFrame(()=>{
      if(active&&!document.querySelector('dialog[open]'))canvas.focus({preventScroll:true});
    });
  });
  canvas.addEventListener('keydown',event=>{
    if(!active||document.querySelector('dialog[open]'))return;
    const flightKeys=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space',...(physicsSelected()?['KeyQ','KeyE']:[])];
    if(flightKeys.includes(event.code)){
      event.preventDefault();
      if(event.code==='Space'){if(!event.repeat)togglePause();}
      else if(!paused)keys.add(event.code);
    }
  });
  window.addEventListener('keyup',event=>keys.delete(event.code));
  canvas.addEventListener('blur',clear);window.addEventListener('blur',clear);
  document.addEventListener('visibilitychange',clear);
  window.addEventListener('pagehide',disposePhysics);
  window.addEventListener('pageshow',event=>{if(event.persisted&&active&&physicsSelected())void initializePhysics();});
  function setActive(value:boolean){
    if(value===active)return;
    active=value;clear();
    el('sandbox-panel').hidden=!value;el('sandbox-controls').hidden=!value;
    if(value){canvas.focus();if(physicsSelected()&&phase==='idle')void initializePhysics();}
  }
  return {
    currentPose() { return {...(physicsSelected()?(lastAircraftPose??application.sandbox.start):state)}; },
    relocate() {
      state={...application.sandbox.start};application.sandbox.current=state;simulation.reset(state);
      if(physicsSelected()){
        if(phase==='loading')void initializePhysics();else if(aircraft)resetPhysics();
      }
      clear();lastHud=-Infinity;saveApplication();
    },
    suspend(){setActive(false);},
    tick(dt:number,now:number,performanceLabel:string){
      setActive(true);
      const controls={pitch:Number(keys.has('ArrowUp'))-Number(keys.has('ArrowDown')),bank:Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft'))};
      const blocked=!!document.querySelector('dialog[open]')||document.hidden;
      if(blocked)clear();
      let physicsPose:AircraftState|undefined=physicsSelected()?lastAircraftPose:undefined;
      if(physicsSelected()){
        throttle.disabled=trim.disabled=phase!=='ready';
        if(physics&&phase==='ready'){
          try{
            if(!paused&&!blocked)physics.advance({...controls,rudder:Number(keys.has('KeyE'))-Number(keys.has('KeyQ')),throttle:Number(throttle.value)/100,trim:Number(trim.value)/100},dt);
            physicsPose=!paused&&!blocked?physics.render(interpolateAircraft):physics.snapshot();
            lastAircraftPose=physicsPose;
          }catch{phase='failed';status('Flight dynamics stopped · Reset to recover or choose Simple Free Flight.');clear();}
        }
      }else{
        if(!paused&&!blocked){simulation.advance(controls,dt);state=simulation.snapshot();}
        application.sandbox.current=state;
      }
      const render=physicsSelected()?(physicsPose??{...application.sandbox.start}):!paused&&!blocked?stepSandbox(state,controls,simulation.remainderSeconds):state;
      const course=physicsPose?.courseDeg??render.headingDeg;
      onCourse(course);
      const position=C.Cartesian3.fromDegrees(render.longitudeDeg,render.latitudeDeg,render.ellipsoidHeightM);
      const pose={position,courseDeg:course,yawDeg:render.headingDeg,pitchDeg:render.pitchDeg,rollDeg:render.rollDeg};
      const view=(el('replay-view') as HTMLSelectElement).value;
      if(view==='cockpit'){
        follow.hide();
        viewer.camera.setView({destination:position,orientation:{heading:C.Math.toRadians(pose.yawDeg),pitch:C.Math.toRadians(pose.pitchDeg),roll:C.Math.toRadians(pose.rollDeg)}});
        cameraControls.cockpit();
      } else {
        follow.update(pose,view==='stable',Number((el('follow-distance') as HTMLInputElement).value),Number((el('follow-elevation') as HTMLInputElement).value),
          view==='director'?{...pose,pitchDeg:pose.pitchDeg*.7,rollDeg:pose.rollDeg*.3}:undefined);
      }
      const sample:DirectorSample={timeSeconds:render.timeSeconds,motion:{courseDeg:course,climbDeg:physicsPose?.climbDeg??render.pitchDeg},
        attitude:{yawDeg:render.headingDeg,pitchDeg:render.pitchDeg,rollDeg:render.rollDeg},
        // Raw control deflections are not flight-director setpoints.
        command:physicsSelected()?undefined:{timeSeconds:render.timeSeconds,headingDeg:(render.headingDeg+9.80665*Math.tan(render.commandBankDeg*Math.PI/180)/sandboxGroundSpeedMps*180/Math.PI*2+360)%360,
          pitchDeg:render.commandPitchDeg,provenance:'synthetic'}};
      if(view==='director')overlay.update(pose,sample);
      if(now-lastHud<100)return;lastHud=now;
      el('source-badge').textContent='● SANDBOX';
      el('vehicle-title').textContent=physicsSelected()?'PHYSICS ENGINE · CESSNA 172P':'SIMPLE FREE FLIGHT · CESSNA 172';
      el('pose-note').textContent=`${physicsSelected()?'JSBSim':'Simple flight'} · pitch ${render.pitchDeg.toFixed(1)}° · bank ${render.rollDeg.toFixed(1)}°`;
      const flightStatus=paused?'paused':blocked?'suspended':document.activeElement===canvas?'flying · keys active':'coasting · click Fly to steer';
      el('telemetry-status').textContent=physicsSelected()?`Physics Engine ${phase==='ready'?flightStatus:phase}`:`Simple Free Flight ${flightStatus} · 50 m/s ground speed`;
      if(physicsPose)el('physics-readout').textContent=`IAS ${physicsPose.indicatedAirspeedKt.toFixed(1)} kt · GS ${(physicsPose.groundSpeedMps/.514444).toFixed(1)} kt · VS ${Math.round(physicsPose.verticalSpeedMps/.00508)} ft/min`;
      el('alt-reference').textContent='ALT · WGS84';el('alt-read').textContent=`${render.ellipsoidHeightM.toFixed(0)} m`;
      el('heading').textContent=`${render.headingDeg.toFixed(0).padStart(3,'0')}°`;
      el('position').textContent=`${render.latitudeDeg.toFixed(5)}°, ${render.longitudeDeg.toFixed(5)}°`;
      el('height-detail').textContent=physicsSelected()?'WGS84 ellipsoid altitude · airborne dynamics · no terrain collision':'Sandbox altitude limits 100–4000 m WGS84 · no terrain collision';
      el('time').textContent=`Sandbox · ${render.timeSeconds.toFixed(1)} s`;
      el('detail-status').textContent=`${performanceLabel} · ${physicsSelected()?'JSBSim C172 dynamics':'Simple Free Flight · fixed ground speed'}`;
    },
  };
}
