// The web entry: the shared client in a browser, served by Firebase Hosting.
import { startClient } from '@budgetmint/client/start';
import { webCloud } from './firebaseConfig';
import { registerServiceWorker } from './offline/register';
import { createWebShell } from './webShell';

void startClient(document.getElementById('root') as HTMLElement, {
  shell: createWebShell(),
  cloud: webCloud(import.meta.env),
});
// The app shell, kept for opening offline (offline/shell.ts)
registerServiceWorker(import.meta.env.PROD);
