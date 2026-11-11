// Adapted from TaskMint apps/web/vite.config.ts @ 1623bee.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web app: built into dist/, which Firebase Hosting serves
// (firebase.json). In development it syncs with the real project, or with
// the emulators when VITE_FIREBASE_EMULATOR_HOST is set (.env).
export default defineConfig({
  plugins: [react()],
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
