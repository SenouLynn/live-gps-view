import { defineConfig, loadEnv } from 'vite';
import cesium from 'vite-plugin-cesium';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'GCS_');
  return {
    plugins: [cesium()],
    server: { proxy: { '/api/events': {
      target: process.env.GCS_BACKEND_URL || env.GCS_BACKEND_URL || 'http://127.0.0.1:8080',
      changeOrigin: false,
      configure(proxy) {
        proxy.on('proxyRes', response => { response.headers['cache-control'] = 'no-cache'; });
      },
    } } },
  };
});
