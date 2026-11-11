// The desktop and Android entry: the shared client in the app's Tauri shell,
// with its data in the cloud.
import { startClient } from '@budgetmint/client/start';
import type { Capabilities } from '@budgetmint/client/shell';
import { command, createTauriShell } from './tauriShell';
import { desktopExtensions } from './extensions';
import { desktopCloud, googleDesktopClient } from './firebaseConfig';

async function start() {
  const capabilities = await command<Capabilities>('get_capabilities');
  await startClient(document.getElementById('root') as HTMLElement, {
    shell: createTauriShell(capabilities, googleDesktopClient(import.meta.env)),
    extensions: desktopExtensions(capabilities),
    cloud: desktopCloud(import.meta.env),
  });
}

void start();
