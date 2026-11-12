/**
 * The menus' Check for Updates… (the tray's and the macOS menu bar's): the
 * Rust side's menu.rs brings the window forward, then sends it as an event.
 * Their other items are the client's (the shell's `menu`, tauriShell.ts).
 */

import { useEffect } from 'react';
import { subscribe } from './tauriShell';
import { updates } from './updates';

/** Check for Updates… (src-tauri/src/events.rs). */
export const CHECK_FOR_UPDATES = 'check-for-updates';

/** Checks when the menus' Check for Updates… is clicked, and says what it found, while mounted. */
export function useCheckForUpdatesCommand(): void {
  useEffect(() => subscribe<null>(CHECK_FOR_UPDATES, () => void updates.check({ manual: true, report: true })), []);
}
