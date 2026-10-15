import * as C from 'cesium';

/** Only a read-scoped, browser-visible ion token belongs in this setting. */
export function setupSceneSource(viewer: C.Viewer, onTerrainSelected: () => void) {
  const select = document.getElementById('scene-source') as HTMLSelectElement;
  const status = document.getElementById('scene-status')!;
  const token = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim();
  let tileset: C.Cesium3DTileset | undefined;
  let loading: Promise<void> | undefined;
  let meshError = false;
  let googleDetail = 8;
  let pending = 0;
  const isGoogle = () => select.value === 'google';
  function showSelected() {
    const google = isGoogle();
    if (tileset) tileset.show = google;
    viewer.scene.globe.show = !google || !tileset;
    if (!google) {
      status.textContent = 'Scene: terrain + aerial imagery';
      onTerrainSelected();
    } else if (!token) {
      status.textContent = 'Google 3D needs VITE_CESIUM_ION_TOKEN · showing terrain';
    } else if (tileset) {
      status.textContent = meshError ? 'Google 3D tiles incomplete · check network or reload' : 'Scene: Google Photorealistic 3D · AGL still references bare-earth terrain';
    } else {
      status.textContent = 'Loading Google Photorealistic 3D · terrain shown until ready';
    }
  }
  async function loadGoogle() {
    if (!token || tileset) return;
    if (loading) return loading;
    loading = (async () => {
      try {
        const resource = await C.IonResource.fromAssetId(2275207, { accessToken: token });
        const loaded = await C.Cesium3DTileset.fromUrl(resource, {
          maximumScreenSpaceError: googleDetail,
          cacheBytes: 512 * 1024 * 1024,
          maximumCacheOverflowBytes: 256 * 1024 * 1024,
          showCreditsOnScreen: true,
        });
        tileset = viewer.scene.primitives.add(loaded);
        loaded.maximumScreenSpaceError = googleDetail;
        loaded.loadProgress.addEventListener((requests: number, processing: number) => { pending = requests + processing; });
        loaded.tileFailed.addEventListener(() => {
          meshError = true;
          if (isGoogle()) showSelected();
        });
        showSelected();
      } catch {
        // Do not echo resource URLs or SDK errors: they may contain access credentials.
        if (isGoogle()) {
          select.value = 'terrain';
          showSelected();
          status.textContent = 'Google 3D unavailable · showing terrain. Check token access to asset 2275207, then select Google 3D to retry.';
        }
      } finally {
        loading = undefined;
      }
    })();
    return loading;
  }
  select.onchange = () => { showSelected(); if (isGoogle()) void loadGoogle(); };
  select.value = token ? 'google' : 'terrain';
  showSelected();
  if (isGoogle()) void loadGoogle();
  return {
    setDetail(name: string) {
      googleDetail = name === 'ultra' ? 4 : name === 'high' ? 8 : 16;
      if (tileset) tileset.maximumScreenSpaceError = googleDetail;
    },
    getStatus() {
      return isGoogle() && tileset
        ? `Google 3D · ${pending ? pending + ' mesh tiles pending' : 'Mesh queue idle'}${meshError ? ' · tile errors' : ''}`
        : undefined;
    },
  };
}
