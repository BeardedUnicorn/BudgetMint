/**
 * The menus' items that need the webview: the tray's and the macOS app
 * menu's Settings… and Check for Updates… (the Rust side's menu.rs brings
 * the window forward, then sends them as events).
 */

import { useEffect } from 'react';
import { subscribe } from './tauriShell';
import { updates } from './updates';

/** Settings… (src-tauri/src/events.rs). */
export const OPEN_SETTINGS = 'open-settings';
/** Check for Updates… (src-tauri/src/events.rs). */
export const CHECK_FOR_UPDATES = 'check-for-updates';

/** macOS (and iOS): the client's shortcuts use ⌘ there, Ctrl elsewhere. */
export function isMac(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/**
 * The client's Settings shortcut, ⌘, (Ctrl+, off macOS), as a key press
 * (packages/client/src/hooks/useKeyboardShortcuts.ts).
 */
export function settingsShortcut(mac: boolean): KeyboardEventInit {
  return { key: ',', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true };
}

/**
 * Opens Settings the way ⌘, does, by pressing it: the client's own shortcut
 * then decides, so it waits while a dialog is open, and before sign-in.
 * (A ⌘, the page opens Settings on and the menu's echo of it both land on
 * Settings, so one press acting twice changes nothing.)
 */
export function openSettings(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', settingsShortcut(isMac())));
}

/** Acts on the menus' Settings… and Check for Updates… while mounted. */
export function useMenuCommands(): void {
  useEffect(() => {
    const stops = [
      subscribe<null>(OPEN_SETTINGS, openSettings),
      subscribe<null>(CHECK_FOR_UPDATES, () => void updates.check({ manual: true, report: true })),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, []);
}
