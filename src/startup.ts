import './style.css';
import { validationScenarios } from './validationScenarios.ts';
import { parseLocation } from './location';
import { application, saveApplication } from './applicationState';
import { workflows, workflowById, type Workflow, type WorkflowDescriptor, type WorkflowPath } from './workflows';
import { durationSeconds } from './pose';
const el = (id: string) => document.getElementById(id)!;
const field = (id: string) => el(id) as HTMLInputElement;
const setup = el('startup') as HTMLDialogElement;
const form = el('startup-form') as HTMLFormElement;
const submit = el('startup-action') as HTMLButtonElement;
const startFields = ['start-lat', 'start-lon', 'start-height', 'start-heading'];
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
let launched = false;

/** What each available path will actually use, read from the saved session. */
const pathDetail: Record<string, () => string> = {
  'yalb-bridge': () => 'SSE /api/events → GCS_BACKEND_URL',
  'demo-replay': () => `${validationScenarios.find(s=>s.id===application.controls['validation-scenario'])?.name??'Burlington figure eight'} · ${clock(application.controls['validation-scenario']&&application.controls['validation-scenario']!=='figure-eight'?12:durationSeconds)} · ${application.replay.time > 0 ? `resumes at ${clock(application.replay.time)}` : 'from start'}`,
  'physics-flight': () => 'Cessna 172P · JSBSim · 100 kt · new trimmed flight at configured start',
  'keyboard-flight': () => {
    if (!startFields.every(id => field(id).checkValidity())) return 'Check the start values below';
    const [lat, lon, alt, hdg] = startFields.map(id => Number(field(id).value));
    const saved = application.sandbox.start;
    const edited = lat !== saved.latitudeDeg || lon !== saved.longitudeDeg || alt !== saved.ellipsoidHeightM || hdg !== saved.headingDeg;
    const flown = application.sandbox.current.timeSeconds;
    const resume = edited ? ' · new flight' : flown > 0 ? ` · resumes at ${clock(flown)}` : '';
    return `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'} ${Math.abs(lon).toFixed(4)}° ${lon < 0 ? 'W' : 'E'} · ${Math.round(alt)} m · HDG ${String(Math.round(hdg) % 360).padStart(3, '0')}°${resume}`;
  },
};
const launchable = (workflow: WorkflowDescriptor, path: WorkflowPath) => workflow.status === 'available' && path.status === 'available';

function render() {
  const map = el('workflow-map');
  for (const workflow of workflows) {
    const ready = workflow.paths.filter(path => launchable(workflow, path)).length;
    const group = document.createElement('div');
    group.className = 'workflow-group';
    group.dataset.workflow = workflow.id;
    group.innerHTML = `<div class="workflow-head"><b>${workflow.title}</b><span class="workflow-source">${workflow.source}</span>
      <span class="workflow-summary">${workflow.summary}</span><span class="workflow-ready">${ready}/${workflow.paths.length} ready</span></div>`;
    for (const path of workflow.paths) {
      const row = document.createElement('label');
      row.className = 'path-row';
      const ok = launchable(workflow, path);
      row.dataset.status = ok ? 'available' : 'todo';
      // TODO paths stay on the map but cannot be chosen.
      row.innerHTML = `<input type="radio" name="path" value="${workflow.id}/${path.id}"${ok ? '' : ' disabled'}><span class="path-name">${path.label}</span>
        ${ok ? `<span class="path-detail" data-path="${path.id}"></span>` : '<span class="path-status">TODO</span>'}`;
      row.querySelector('input')!.onchange = () => select(workflow.id as Workflow, path.id);
      group.append(row);
    }
    // A workflow's settings sit directly under its paths.
    const settings = document.querySelector(`[data-workflow-settings="${workflow.id}"]`);
    if (settings) group.append(settings);
    map.append(group);
  }
}
function syncDetails() {
  for (const cell of Array.from(document.querySelectorAll<HTMLElement>('.path-detail')))
    cell.textContent = pathDetail[cell.dataset.path!]?.() ?? '';
}

function select(id: Workflow, pathId?: string) {
  const workflow = workflowById(id);
  const preferredPath = pathId ?? (id === 'sandbox' ? application.sandbox.mode === 'physics' ? 'physics-flight' : 'keyboard-flight' : undefined);
  const path = workflow.paths.find(candidate => candidate.id === preferredPath)
    ?? workflow.paths.find(candidate => launchable(workflow, candidate)) ?? workflow.paths[0];
  const ok = launchable(workflow, path);
  // Only launchable choices persist, so a reload never restores a dead end.
  if (ok) {
    application.workflow = id;
    if (id === 'sandbox') application.sandbox.mode = path.id === 'physics-flight' ? 'physics' : 'simple';
    saveApplication();
  }
  for (const input of Array.from(form.querySelectorAll<HTMLInputElement>('input[name=path]'))) input.checked = input.value === `${id}/${path.id}`;
  for (const group of Array.from(document.querySelectorAll<HTMLElement>('.workflow-group'))) group.classList.toggle('is-selected', group.dataset.workflow === id);
  for (const settings of Array.from(document.querySelectorAll<HTMLElement>('[data-workflow-settings]'))) {
    settings.hidden = !ok || settings.dataset.workflowSettings !== id;
    for (const input of Array.from(settings.querySelectorAll('input'))) input.disabled = settings.hidden;
  }
  el('workflow-brief').textContent = ok ? workflow.brief : '';
  submit.textContent = workflow.action;
  submit.disabled = !ok;
}

// ---------- Sandbox start: inline validation ----------
const messages: Record<string, string> = {
  'start-lat': 'Enter a latitude between −85° and 85°.',
  'start-lon': 'Enter a longitude between −180° and 180°.',
  'start-height': 'Enter an altitude between 100 and 4,000 m.',
  'start-heading': 'Enter a heading from 0° to 359.99°.',
};
function validate(id: string) {
  const input = field(id);
  const message = input.disabled || input.checkValidity() ? '' : messages[id];
  input.setAttribute('aria-invalid', String(message !== ''));
  el(`${id}-error`).textContent = message;
  return message === '';
}
const start = application.sandbox.start;
for (const [id, value] of Object.entries({ 'start-lat': start.latitudeDeg, 'start-lon': start.longitudeDeg, 'start-height': start.ellipsoidHeightM, 'start-heading': start.headingDeg })) {
  field(id).value = String(value);
  field(id).addEventListener('input', () => { if (field(id).getAttribute('aria-invalid') === 'true') validate(id); syncDetails(); });
  field(id).addEventListener('blur', () => validate(id));
}

el('startup-location').onclick = async () => {
  try {
    const { openLocationPicker } = await import('./locationPicker');
    await openLocationPicker({ initial: parseLocation(field('start-lat').value, field('start-lon').value) ?? {lat:application.sandbox.start.latitudeDeg,lon:application.sandbox.start.longitudeDeg},
      action: 'Use this starting point', onSelect(point) {
        field('start-lat').value = String(point.lat); field('start-lon').value = String(point.lon);
        for (const id of ['start-lat', 'start-lon']) { field(id).dispatchEvent(new Event('input')); validate(id); }
        syncDetails();
      } });
  } catch { el('start-lat-error').textContent = 'The map could not load. You can still enter coordinates here.'; }
};

// ---------- Launch ----------
el('startup-reload').onclick = () => location.reload();
async function launch() {
  application.screen = 'workspace'; saveApplication();
  el('workflow-name').textContent = workflowById(application.workflow).title;
  setup.close();
  if (launched) return;
  launched = true;
  try { await import('./main'); }
  catch {
    application.screen = 'setup'; saveApplication();
    openSetup();
    el('startup-error').hidden = false;
  }
}
form.addEventListener('submit', event => {
  event.preventDefault();
  if (submit.disabled) return;
  if (application.workflow === 'sandbox') {
    const invalid = startFields.filter(id => !validate(id));
    if (invalid.length) { field(invalid[0]).focus(); return; }
    const next = { ...application.sandbox.start, latitudeDeg: Number(field('start-lat').value), longitudeDeg: Number(field('start-lon').value),
      ellipsoidHeightM: Number(field('start-height').value), headingDeg: Number(field('start-heading').value) };
    if (JSON.stringify(next) !== JSON.stringify(application.sandbox.start)) application.sandbox.current = { ...next };
    application.sandbox.start = next;
  }
  void launch();
});
el('change-workflow').onclick = () => { application.screen = 'setup'; saveApplication(); location.reload(); };
setup.addEventListener('cancel', event => event.preventDefault());

function openSetup() {
  setup.showModal();
  syncDetails();
  select(application.workflow);
  // The dialog would otherwise focus the first radio, which reads as a second selection.
  form.querySelector<HTMLInputElement>('input[name=path]:checked')?.focus({ focusVisible: false } as FocusOptions);
}
render();
if (application.screen === 'workspace') void launch();
else openSetup();
