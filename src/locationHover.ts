import * as C from 'cesium';
import { createLocationDropGuide } from './locationDropGuide';

/** Optional, local-only inspection of the rendered surface. No geocoding requests. */
export function setupLocationHover(viewer: C.Viewer, toggle: HTMLInputElement,
  detailFor: (entity: unknown) => string | undefined) {
  const scene = viewer.scene;
  const canvas = scene.canvas;
  const guide = createLocationDropGuide(viewer);
  const labels = scene.primitives.add(new C.LabelCollection()) as C.LabelCollection;
  const label = labels.add({
    position: C.Cartesian3.ZERO, show: false, font: '13px monospace', fillColor: C.Color.WHITE,
    showBackground: true, backgroundColor: C.Color.fromCssColorString('#102027').withAlpha(0.94),
    backgroundPadding: new C.Cartesian2(10, 8), pixelOffset: new C.Cartesian2(14, -14),
    horizontalOrigin: C.HorizontalOrigin.LEFT, verticalOrigin: C.VerticalOrigin.BOTTOM,
    // Keep terrain/building depth testing so the label belongs to the visible surface.
    disableDepthTestDistance: 0,
  });
  let cursor: C.Cartesian2 | undefined;
  let lastUpdate = 0;
  let settledAt = 0;
  function clear() { cursor = undefined; label.show = false; guide.hide(); }
  function move(event: PointerEvent) {
    if (!toggle.checked || event.buttons || event.pointerType === 'touch') { clear(); return; }
    const bounds = canvas.getBoundingClientRect();
    cursor = new C.Cartesian2(event.clientX - bounds.left, event.clientY - bounds.top);
    settledAt = performance.now();
    label.show = false;
    guide.hide();
  }
  function changed() { clear(); }
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerleave', clear);
  canvas.addEventListener('pointerdown', clear);
  window.addEventListener('blur', clear);
  toggle.addEventListener('change', changed);
  const removeRender = scene.preRender.addEventListener(() => {
    if (!toggle.checked || !cursor) { label.show = false; guide.hide(); return; }
    const now = performance.now();
    if (now - settledAt < 200 || now - lastUpdate < 120) return;
    lastUpdate = now;
    label.show = false;
    try {
      const picked = scene.pick(cursor);
      let position: C.Cartesian3 | undefined;
      // Depth picking includes Google buildings; a globe ray supplies terrain fallback.
      if (scene.pickPositionSupported) position = scene.pickPosition(cursor);
      if (!position) {
        const ray = viewer.camera.getPickRay(cursor);
        if (ray && scene.globe.show) position = scene.globe.pick(ray, scene);
      }
      if (!position) { guide.hide(); return; }
      const point = C.Cartographic.fromCartesian(position);
      if (![point.latitude, point.longitude, point.height].every(Number.isFinite)) { guide.hide(); return; }
      const detail = detailFor(picked?.id);
      // Wrap long overlay descriptions to keep the label readable.
      const wrapped = detail?.match(/.{1,58}(?:\s|$)|\S{1,58}/g)?.map(line => line.trim()).join('\n');
      guide.update(position);
      label.position = position;
      label.text = `${C.Math.toDegrees(point.latitude).toFixed(5)}°, ${C.Math.toDegrees(point.longitude).toFixed(5)}°\nSurface ${point.height.toFixed(1)} m WGS84${wrapped ? '\n' + wrapped : ''}`;
      label.show = true;
    } catch {
      // Unavailable depth or a changing tile must not interrupt flight rendering.
      label.show = false;
      guide.hide();
    }
  });
  window.addEventListener('pagehide', () => {
    removeRender();
    guide.destroy();
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerleave', clear);
    canvas.removeEventListener('pointerdown', clear);
    window.removeEventListener('blur', clear);
    toggle.removeEventListener('change', changed);
    if (!scene.isDestroyed()) scene.primitives.remove(labels);
  }, { once: true });
}
