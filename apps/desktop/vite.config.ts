// Adapted from TaskMint apps/desktop/vite.config.ts @ 1623bee.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { budgetmintEnvironmentPlugin } from '../../scripts/environment.mjs';

// `tauri android dev --host` (for a phone on the network) sets TAURI_DEV_HOST
// to this computer's address there: the dev server then listens on it, and
// live reload connects to it (tauri.android.conf.json's devCsp allows that).
// Unset, as on the desktop and in the Android emulator, the server stays on
// localhost.
const host = process.env.TAURI_DEV_HOST;

// BUDGETMINT_ENV picks the Firebase projects, dev unless it's production
// (scripts/environment.mjs); the Tauri CLI passes it on from its own
// environment, as it does to Cargo and Gradle. dist/environment.json says
// which, for scripts/release.mjs's check.
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), budgetmintEnvironmentPlugin()],
  // Favicon and logos live with the shared client.
  publicDir: '../../packages/client/public',
  // .env (the Google sign-in client, the emulators) stays at the repo root.
  envDir: '../..',
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    ...(host ? { host, hmr: { protocol: 'ws', host, port: 1430 } } : {}),
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Separate vendor chunks for better caching. Rolldown (vite 8)
        // only accepts the function form.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor';
          if (id.includes('/node_modules/@mui/')) return 'mui-vendor';
          if (/\/node_modules\/(recharts|victory-vendor|d3-[^/]+)\//.test(id)) return 'chart-vendor';
          if (id.includes('/node_modules/dayjs/')) return 'date-vendor';
          if (id.includes('/node_modules/@tauri-apps/')) return 'tauri-vendor';
          // Loaded behind the start screen
          if (/\/node_modules\/(firebase|@firebase)\//.test(id)) return 'firebase-vendor';
          return undefined;
        },
      },
    },
  },
});
