// Adapted from TaskMint apps/web/vite.config.ts @ 1623bee.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { budgetmintEnvironmentPlugin } from '../../scripts/environment.mjs';
import { webBuild } from './src/build/plugin';

// The web app: built into dist/, which Firebase Hosting serves
// (firebase.json). It syncs with the dev projects unless BUDGETMINT_ENV is
// production (scripts/environment.mjs), or with the emulators when a
// development build sets VITE_FIREBASE_EMULATOR_HOST (.env).
export default defineConfig({
  plugins: [
    react(),
    // The build's environment, and dist/environment.json saying which
    budgetmintEnvironmentPlugin(),
    // public/ (the manifest and icons, robots.txt, the privacy and terms
    // pages) beside the client's, and the service worker, /sw.js. The
    // environment marker is for the deploy's check, not the page.
    webBuild({
      publicDir: fileURLToPath(new URL('./public', import.meta.url)),
      worker: fileURLToPath(new URL('./src/offline/worker.ts', import.meta.url)),
      notOffline: ['robots.txt', 'social.png', 'environment.json'],
    }),
  ],
  // Favicon and logos live with the shared client.
  publicDir: '../../packages/client/public',
  // .env (the emulators) stays at the repo root.
  envDir: '../..',
  server: {
    port: 1431,
    strictPort: true,
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Separate vendor chunks for better caching (rolldown takes the
        // function form only).
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor';
          if (id.includes('/node_modules/@mui/')) return 'mui-vendor';
          if (/\/node_modules\/(firebase|@firebase)\//.test(id)) return 'firebase-vendor';
          if (/\/node_modules\/(recharts|victory-vendor|d3-[^/]+)\//.test(id)) return 'chart-vendor';
          if (id.includes('/node_modules/dayjs/')) return 'date-vendor';
          return undefined;
        },
      },
    },
  },
});
