import * as C from 'cesium';

/** Screen overlay avoids feeding our own markers back into Cesium depth picking. */
export function createLocationDropGuide(viewer: C.Viewer) {
  const scene = viewer.scene;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%',
    pointerEvents: 'none', overflow: 'hidden' });
  const line = document.createElementNS(ns, 'line');
  line.setAttribute('stroke', '#ffd166');
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-dasharray', '5 4');
  const ground = document.createElementNS(ns, 'circle');
  ground.setAttribute('r', '7');
  ground.setAttribute('fill', '#102027');
  ground.setAttribute('stroke', '#ffd166');
  ground.setAttribute('stroke-width', '2');
  const surface = document.createElementNS(ns, 'circle');
  surface.setAttribute('r', '4');
  surface.setAttribute('fill', '#9fe8c6');
  surface.setAttribute('stroke', '#102027');
  surface.setAttribute('stroke-width', '2');
  svg.append(line, ground, surface);
  viewer.container.append(svg);
  let position: C.Cartesian3 | undefined;
  let groundPosition: C.Cartesian3 | undefined;
  let key = '';
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let alive = true;
  let provider = viewer.terrainProvider;
  function hide() {
    position = undefined; groundPosition = undefined; key = ''; generation++;
    clearTimeout(timer); svg.style.display = 'none';
  }
  hide();
  function update(value: C.Cartesian3) {
    position = C.Cartesian3.clone(value);
    const point = C.Cartographic.fromCartesian(value);
    const nextKey = `${point.latitude.toFixed(7)},${point.longitude.toFixed(7)}`;
    if (key === nextKey && provider === viewer.terrainProvider) return;
    provider = viewer.terrainProvider;
    key = nextKey;
    groundPosition = undefined;
    const current = ++generation;
    clearTimeout(timer);
    // An ellipsoid is not a measurement of the ground.
    if (provider instanceof C.EllipsoidTerrainProvider) return;
    const terrain = provider;
    timer = setTimeout(async () => {
      try {
        const [sample] = await C.sampleTerrainMostDetailed(terrain,
          [new C.Cartographic(point.longitude, point.latitude)]);
        if (!alive || current !== generation || terrain !== viewer.terrainProvider || !Number.isFinite(sample.height)) return;
        // A sampled terrain surface can sit slightly above a mesh due to source differences.
        if (sample.height > point.height + 3) return;
        groundPosition = C.Cartesian3.fromRadians(point.longitude, point.latitude, sample.height);
        scene.requestRender();
      } catch { /* Keep the surface dot when ground data is unavailable. */ }
    }, 350);
  }
  const removeRender = scene.postRender.addEventListener(() => {
    const top = position && C.SceneTransforms.worldToWindowCoordinates(scene, position);
    svg.style.display = top ? 'block' : 'none';
    if (!top) return;
    surface.setAttribute('cx', String(top.x)); surface.setAttribute('cy', String(top.y));
    const bottom = groundPosition && C.SceneTransforms.worldToWindowCoordinates(scene, groundPosition);
    line.style.display = ground.style.display = bottom ? '' : 'none';
    if (bottom) {
      line.setAttribute('x1', String(top.x)); line.setAttribute('y1', String(top.y));
      line.setAttribute('x2', String(bottom.x)); line.setAttribute('y2', String(bottom.y));
      ground.setAttribute('cx', String(bottom.x)); ground.setAttribute('cy', String(bottom.y));
    }
  });
  return { update, hide, destroy() { alive = false; hide(); removeRender(); svg.remove(); } };
}
