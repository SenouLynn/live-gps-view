import { controllerStorageKey, flightAxes, parseProfile, readController, validBinding, type ControllerDevice, type ControllerProfile, type FlightAxis } from './controllerInput.ts';

export function setupControllerPanel(onInterrupt: () => void) {
  const button = document.getElementById('controller-setup') as HTMLButtonElement;
  const enable = document.getElementById('controller-enable') as HTMLInputElement;
  const status = document.getElementById('controller-status')!;
  const dialog = document.createElement('dialog');
  dialog.id = 'controller-dialog';
  dialog.innerHTML = `<h2>Flight controller setup</h2>
    <p>Connect USB in joystick mode, or pair the radio in your computer’s Bluetooth settings using ELRS BLE Joystick. Move a stick if no device appears.</p>
    <p>Assign pitch and roll to enable flight. Rudder and throttle are optional. Separate HOTAS devices are supported. For each axis, hold each end of travel and capture Low / High; release centering sticks and capture Center. Reverse as needed: positive pitch raises the nose, positive roll banks right, positive rudder turns right. Throttle Low means idle unless reversed.</p>
    <div id="controller-rows"></div><p id="controller-preview" role="status"></p>
    <p>Simple Free Flight uses pitch and roll with fixed speed. Physics Engine also uses rudder and throttle. Focus loss or a missing device pauses controller flight; enable again and press Resume.</p>
    <div class="row-actions"><button type="button" id="controller-save">Save mappings</button><button type="button" id="controller-close">Cancel</button></div>`;
  document.body.append(dialog);
  let profile: ControllerProfile = {};
  try { profile = parseProfile(localStorage.getItem(controllerStorageKey)); } catch { /* unavailable storage */ }
  let draft: ControllerProfile = {}, enabled = false, frame = 0;
  let notice = '';
  const labels: Record<FlightAxis, string> = {pitch:'Pitch',bank:'Roll',rudder:'Rudder',throttle:'Throttle'};
  function devices(): ControllerDevice[] {
    try { return Array.from(navigator.getGamepads?.() ?? []).filter((d): d is Gamepad => !!d && d.connected); }
    catch { return []; }
  }
  function disarm(message: string) {
    const wasEnabled = enabled;
    enabled = false; enable.checked = false; notice = message; status.textContent = message;
    if (wasEnabled) onInterrupt();
  }
  function buildRows() {
    const root = dialog.querySelector('#controller-rows')!; root.replaceChildren();
    const available = devices();
    for (const axis of flightAxes) {
      const row = document.createElement('fieldset'); row.className = 'controller-axis';
      const legend = document.createElement('legend'); legend.textContent = labels[axis]; row.append(legend);
      const select = document.createElement('select'); select.setAttribute('aria-label', `${labels[axis]} device and axis`);
      select.append(new Option('Unassigned', ''));
      for (const d of available) for (let i=0; i<d.axes.length; i++) {
        const option = new Option(`${d.id} · axis ${i+1}`, JSON.stringify([d.id,i])); select.append(option);
      }
      const binding = draft[axis];
      if (binding) {
        const value = JSON.stringify([binding.device,binding.axis]);
        if (!Array.from(select.options).some(o=>o.value===value)) select.append(new Option(`${binding.device} · axis ${binding.axis+1} (missing)`,value));
        select.value = value;
      }
      select.onchange = () => {
        if (!select.value) delete draft[axis];
        else { const [device,index] = JSON.parse(select.value) as [string,number]; draft[axis] = {device,axis:index,min:-1,center:0,max:1,reversed:false,deadzone:.03}; }
        buildRows();
      };
      row.append(select);
      const output = document.createElement('output'); output.id=`controller-raw-${axis}`; row.append(output);
      if (binding) {
        const captures = document.createElement('div'); captures.className='row-actions';
        for (const [key,label] of [['min','Low'],['center','Center'],['max','High']] as const) {
          if (axis==='throttle' && key==='center') continue;
          const capture = document.createElement('button'); capture.type='button';
          capture.textContent=`${label}: ${binding[key].toFixed(3)}`;
          capture.onclick=()=>{
            const matches=devices().filter(d=>d.id===binding.device);
            const raw=matches[0]?.axes[binding.axis];
            if(matches.length===1 && Number.isFinite(raw)) {
              binding[key]=raw;
              if(axis==='throttle')binding.center=(binding.min+binding.max)/2;
              buildRows();
            }
          };
          captures.append(capture);
        }
        row.append(captures);
        const reverse=document.createElement('input');reverse.type='checkbox';reverse.checked=binding.reversed;
        reverse.onchange=()=>{binding.reversed=reverse.checked;};
        const reverseLabel=document.createElement('label');reverseLabel.append(reverse,' Reverse');row.append(reverseLabel);
        if(axis!=='throttle') {
          const deadzone=document.createElement('input');deadzone.type='number';deadzone.min='0';deadzone.max='30';deadzone.step='1';deadzone.value=String(Math.round(binding.deadzone*100));
          deadzone.setAttribute('aria-label',`${labels[axis]} dead zone percent`);
          deadzone.oninput=()=>{binding.deadzone=Number(deadzone.value)/100;};
          const label=document.createElement('label');label.append('Dead zone % ',deadzone);row.append(label);
        }
      }
      root.append(row);
    }
  }
  let deviceSignature='';
  function preview() {
    if(!dialog.open)return;
    const current=devices();
    const signature=JSON.stringify(current.map(d=>[d.id,d.index,d.axes.length]));
    if(signature!==deviceSignature){deviceSignature=signature;buildRows();}
    for(const axis of flightAxes){
      const b=draft[axis], matches=current.filter(d=>d.id===b?.device), raw=b?matches[0]?.axes[b.axis]:undefined;
      dialog.querySelector(`#controller-raw-${axis}`)!.textContent=Number.isFinite(raw)?` Raw ${raw!.toFixed(3)}`:' No input';
    }
    const values=readController(draft,current);
    dialog.querySelector('#controller-preview')!.textContent=values
      ?flightAxes.filter(a=>values[a]!==undefined).map(a=>`${labels[a]} ${values[a]!.toFixed(2)}`).join(' · ')
      :'Assign pitch and roll; check device connections and calibration (Low < Center < High). Duplicate device names cannot be distinguished.';
    frame=requestAnimationFrame(preview);
  }
  button.onclick=()=>{
    disarm('Controller setup · flight paused'); onInterrupt();
    draft=structuredClone(profile);buildRows();deviceSignature='';dialog.showModal();preview();
  };
  dialog.querySelector('#controller-close')!.addEventListener('click',()=>dialog.close());
  dialog.querySelector('#controller-save')!.addEventListener('click',()=>{
    if(!draft.pitch || !draft.bank || !Object.values(draft).every(validBinding) || !readController(draft,devices())) {
      dialog.querySelector('#controller-preview')!.textContent='Cannot save: assign pitch and roll, connect each assigned device, and capture valid calibration.';return;
    }
    profile=structuredClone(draft);
    try {localStorage.setItem(controllerStorageKey,JSON.stringify(profile));notice='Mappings saved · enable controller, then Resume.';}
    catch {notice='Mappings ready for this session; browser storage is unavailable.';}
    status.textContent=notice;dialog.close();
  });
  dialog.addEventListener('close',()=>{cancelAnimationFrame(frame);button.focus();});
  enable.onchange=()=>{
    if(!enable.checked){disarm('Keyboard controls · controller disabled');return;}
    if(!readController(profile,devices())){enable.checked=false;status.textContent='Open Controller setup to assign connected pitch and roll axes.';return;}
    enabled=true;notice='Controller ready · press Resume to fly';status.textContent=notice;onInterrupt();
  };
  const interrupt=()=>{if(enabled)disarm('Controller suspended · enable again and Resume.');};
  window.addEventListener('blur',interrupt);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)interrupt();});
  window.addEventListener('gamepaddisconnected',()=>{if(enabled&&!readController(profile,devices()))disarm('Controller disconnected · flight paused. Reconnect, enable, and Resume.');});
  if(!navigator.getGamepads || !window.isSecureContext) {
    enable.disabled=true;status.textContent='Controller input requires a supported browser on HTTPS or localhost.';
  }else status.textContent='USB / Bluetooth · keyboard active';
  return {
    get enabled(){return enabled;},
    sample(){
      if(!enabled)return undefined;
      const values=readController(profile,devices());
      if(!values){disarm('Controller input lost · flight paused. Check connection and enable again.');return undefined;}
      return values;
    },
    suspend(){interrupt();},
  };
}
