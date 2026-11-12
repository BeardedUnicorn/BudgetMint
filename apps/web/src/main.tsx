// The web entry: the shared client in a browser, served by Firebase Hosting.
import { startClient } from '@budgetmint/client/start';
import { webAnalytics } from './analytics';
import { webCloud } from './firebaseConfig';
import { registerServiceWorker } from './offline/register';
import { createWebShell } from './webShell';

const cloud = webCloud(import.meta.env);

void startClient(document.getElementById('root') as HTMLElement, {
  shell: createWebShell(Date.now, webAnalytics(cloud)),
  cloud,
});
// The app shell, kept for opening offline (offline/shell.ts)
registerServiceWorker(import.meta.env.PROD);
