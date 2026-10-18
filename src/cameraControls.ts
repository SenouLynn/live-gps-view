import * as C from 'cesium';
import { cameraReferencePosition } from './cameraReference.ts';
import { application } from './applicationState.ts';
export interface CameraOffset { yawDeg: number; pitchDeg: number }
export function stepCameraOffset(offset: CameraOffset, horizontal: number, vertical: number, dt: number, returnForward = false): CameraOffset {
  const seconds = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, .1));
  const settle = (value: number, input: number) => returnForward && !input ? Math.abs(value) < .05 ? 0 : value * Math.exp(-seconds / .22) : value;
  return { yawDeg: ((settle(offset.yawDeg, horizontal) + horizontal * 60 * seconds + 180) % 360 + 360) % 360 - 180,
    pitchDeg: Math.max(-75, Math.min(75, settle(offset.pitchDeg, vertical) + vertical * 45 * seconds)) };
}
export function setupCameraControls(viewer: C.Viewer) {
  const canvas = viewer.scene.canvas;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Flight view. WASD moves the camera; R recenters. In Sandbox, arrows steer the aircraft and Space pauses flight.');
  const read = (key: string, min: number, max: number) => {
    const value = Number(application.controls[key] ?? 0);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;
  };
  const offsets = {
    cockpit: { yawDeg: read('camera-cockpit-yaw', -180, 180), pitchDeg: read('camera-cockpit-pitch', -75, 75) },
    follow: { yawDeg: read('camera-follow-yaw', -180, 180), pitchDeg: read('camera-follow-pitch', -75, 75) },
  };
  let mode: 'cockpit' | 'follow' | 'disabled' = 'disabled', context = '';
  type CameraPose = { position: C.Cartesian3; direction: C.Cartesian3; up: C.Cartesian3 };
  const heldPoses = new Map<string, CameraPose>();
  let referenceDirection: C.Cartesian3 | undefined;
  let referenceTarget: C.Cartesian3 | undefined;
  const behavior = document.getElementById('camera-behavior') as HTMLSelectElement;
  const keys = new Set<string>();
  const clear = () => keys.clear();
  const allowed = () => mode !== 'disabled' && document.activeElement === canvas && !document.hidden && !document.querySelector('dialog[open]');
  function persist() {
    for (const name of ['cockpit', 'follow'] as const) {
      application.controls[`camera-${name}-yaw`] = String(offsets[name].yawDeg);
      application.controls[`camera-${name}-pitch`] = String(offsets[name].pitchDeg);
    }
  }
  function reset() {
    if (mode === 'disabled') return;
    offsets[mode] = { yawDeg: 0, pitchDeg: 0 }; clear(); persist();
  }
  canvas.addEventListener('pointerdown', () => { if (mode !== 'disabled' && !document.querySelector('dialog[open]')) canvas.focus({ preventScroll: true }); });
  canvas.addEventListener('keydown', event => {
    if (!allowed() || event.ctrlKey || event.metaKey || event.altKey) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR'].includes(event.code)) {
      event.preventDefault();
      if (event.code === 'KeyR') reset(); else keys.add(event.code);
    }
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  canvas.addEventListener('blur', clear); window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', clear);
  document.getElementById('camera-focus')!.onclick = () => canvas.focus({ preventScroll: true });
  document.getElementById('camera-reset')!.onclick = () => { reset(); canvas.focus({ preventScroll: true }); };
  function renderCockpit() {
    const heldPose = heldPoses.get(context);
    if (mode !== 'cockpit' || !heldPose) return;
    referenceDirection = heldPose.direction; referenceTarget = undefined;
    viewer.camera.setView({ destination: heldPose.position, orientation: { direction: heldPose.direction, up: heldPose.up } });
    viewer.camera.lookRight(C.Math.toRadians(offsets.cockpit.yawDeg));
    viewer.camera.lookUp(C.Math.toRadians(offsets.cockpit.pitchDeg));
  }
  viewer.scene.postRender.addEventListener(() => {
    const reticle = document.getElementById('reticle')!;
    const note = document.getElementById('reticle-reference')!;
    const frustum = viewer.camera.frustum;
    if (mode === 'disabled' || !(frustum instanceof C.PerspectiveFrustum) || (!referenceDirection && !referenceTarget)) {
      reticle.style.removeProperty('left'); reticle.style.removeProperty('top'); reticle.classList.remove('reticle-edge'); note.hidden = true; return;
    }
    const forward = referenceTarget
      ? C.Cartesian3.normalize(C.Cartesian3.subtract(referenceTarget, viewer.camera.positionWC, new C.Cartesian3()), new C.Cartesian3()) : referenceDirection!;
    const at = cameraReferencePosition(forward, viewer.camera.directionWC, viewer.camera.rightWC, viewer.camera.upWC, canvas.clientWidth, canvas.clientHeight, frustum.fovy ?? Math.PI / 3);
    reticle.style.left = `${at.x}px`; reticle.style.top = `${at.y}px`;
    reticle.classList.toggle('reticle-edge', at.edge);
    note.hidden = false; note.textContent = at.edge ? 'Reference off-screen' : mode === 'follow' ? 'Aircraft' : 'Forward';
  });
  return {
    step(dt: number, nextMode: typeof mode, nextContext: string) {
      if (context !== nextContext || mode !== nextMode) { clear(); referenceDirection = undefined; referenceTarget = undefined; context = nextContext; mode = nextMode; }
      if (!allowed()) clear();
      if (mode !== 'disabled') {
        offsets[mode] = stepCameraOffset(offsets[mode], Number(keys.has('KeyD')) - Number(keys.has('KeyA')), Number(keys.has('KeyW')) - Number(keys.has('KeyS')), dt, behavior.value === 'return');
        persist();
      }
      document.getElementById('camera-offset')!.textContent = mode === 'disabled' ? 'Camera keys unavailable in this view'
        : `${mode === 'follow' ? 'Orbit' : 'Look'} · ${offsets[mode].yawDeg.toFixed(0)}° horizontal · ${offsets[mode].pitchDeg.toFixed(0)}° vertical`;
    },
    orbit: () => offsets.follow,
    cockpit() {
      if (heldPoses.size > 64 && !heldPoses.has(context)) heldPoses.delete(heldPoses.keys().next().value!);
      heldPoses.set(context, { position: C.Cartesian3.clone(viewer.camera.positionWC), direction: C.Cartesian3.clone(viewer.camera.directionWC), up: C.Cartesian3.clone(viewer.camera.upWC) });
      renderCockpit();
    },
    hold: renderCockpit,
    followReference(position: C.Cartesian3) { referenceTarget = C.Cartesian3.clone(position); referenceDirection = undefined; },
  };
}
