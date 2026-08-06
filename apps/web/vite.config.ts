import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Where the dev proxy sends `/api`.
 *
 * Configurable rather than fixed at 4000 so the app can be run against an API on
 * another port — which matters when something else already holds 4000, and is the
 * only alternative to pointing the browser straight at the API and dragging CORS
 * and cross-origin CSRF into the local loop.
 */
const API_TARGET = process.env['API_PROXY_TARGET'] ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Proxy /api during development so the browser makes same-origin requests.
    // Removes CORS from the local loop entirely and lets the client use
    // relative URLs; VITE_API_URL still overrides for deployed builds.
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
