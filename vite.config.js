import { defineConfig, loadEnv } from 'vite';
import { airspaceProxy } from './build/airspace-proxy.js';
import { locationProxy } from './build/location-proxy.js';
import cesium from 'vite-plugin-cesium';
import { gnssProxy } from './build/gnss-proxy.js';
import { weatherProxy } from './build/weather-proxy.js';
import { trafficProxy } from './build/traffic-proxy.js';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'GCS_');
  return {
    optimizeDeps: { exclude: ['@0x62/jsbsim-wasm'] },
    plugins: [cesium(), locationProxy(), airspaceProxy(), trafficProxy(), weatherProxy(), gnssProxy()],
    server: { proxy: { '/api/events': {
      target: process.env.GCS_BACKEND_URL || env.GCS_BACKEND_URL || 'http://127.0.0.1:8080',
      changeOrigin: false,
      configure(proxy) {
        proxy.on('proxyRes', response => { response.headers['cache-control'] = 'no-cache'; });
      },
    } } },
  };
});
