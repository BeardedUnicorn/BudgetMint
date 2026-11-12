/**
 * Registers the service worker (worker.ts, served as /sw.js) once the page
 * has loaded, so it doesn't compete with BudgetMint's own start. Only a
 * production build has one: in development, Vite serves the files fresh.
 */

export const SERVICE_WORKER_URL = '/sw.js';

export function registerServiceWorker(enabled: boolean, nav: Navigator = navigator, win: Window = window): void {
  if (!enabled || !('serviceWorker' in nav)) return;
  win.addEventListener(
    'load',
    () => {
      // Without it BudgetMint still works, only not offline
      nav.serviceWorker.register(SERVICE_WORKER_URL).catch(error => {
        console.warn('BudgetMint could not keep its offline copy:', error);
      });
    },
    { once: true }
  );
}
