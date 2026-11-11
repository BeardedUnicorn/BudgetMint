/**
 * The app's start, the same in every shell: the shell, Firebase and core
 * load together, then the app follows the session (signing in first: the
 * data is the account's).
 */

// Self-hosted fonts, as TaskMint's: the theme declares Inter and Roboto
// Mono, and the apps must not depend on network fonts
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/roboto-mono/400.css';
import '@fontsource/roboto-mono/500.css';
import '@fontsource/roboto-mono/600.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { App, StartupError } from './App';
import { BudgetSession } from './cloud/session';
import { cloudErrorMessage } from './cloud/errors';
import { loadFirebase } from './cloud';
import type { BudgetStore, CloudConfig } from './cloud/types';
import { deviceZone, loadCore } from './core';
import type { InitInput } from './core/wasm/budgetmint_core';
import wasmUrl from './core/wasm/budgetmint_core_bg.wasm?url';
import { setShell } from './shell';
import type { AppExtensions, Shell } from './shell/types';
import { readLocal, writeLocal } from './utils/localStore';

export type { AppExtensions } from './shell/types';

export interface StartOptions {
  shell: Shell;
  cloud: CloudConfig;
  extensions?: AppExtensions;
  /** Tests: the store, and core's wasm. */
  loadStore?: () => Promise<BudgetStore>;
  wasm?: InitInput;
}

/** This device's id, written into its documents: made once, then kept. */
export const DEVICE_ID_KEY = 'deviceId';

export function deviceId(): string {
  const kept = readLocal<string | null>(DEVICE_ID_KEY, null);
  if (kept) return kept;
  const made = crypto.randomUUID();
  writeLocal<string | null>(DEVICE_ID_KEY, made, null);
  return made;
}

export async function startClient(container: HTMLElement, options: StartOptions): Promise<BudgetSession | null> {
  const { shell, cloud } = options;
  setShell(shell);
  const root = createRoot(container);
  let loaded: [BudgetStore, Awaited<ReturnType<typeof loadCore>>];
  try {
    loaded = await Promise.all([(options.loadStore ?? loadFirebase(cloud))(), loadCore(options.wasm ?? wasmUrl)]);
  } catch (error) {
    root.render(<StartupError message={cloudErrorMessage(error)} />);
    shell.platform.splashScreen?.hide();
    return null;
  }
  const [store, core] = loaded;
  const { googleSignIn } = shell.platform;
  const google = googleSignIn ? () => googleSignIn() : cloud.popupSignIn ? async () => null : null;
  const session = new BudgetSession(store, core, deviceId(), google);
  session.start();
  // The user may have travelled: "today" is where they are
  window.addEventListener('focus', () => core.setZone(deviceZone()));
  root.render(<App session={session} core={core} extensions={options.extensions ?? {}} />);
  return session;
}
