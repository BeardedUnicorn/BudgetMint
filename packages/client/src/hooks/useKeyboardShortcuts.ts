/**
 * App-wide keyboard shortcuts (⌘ on macOS, Ctrl elsewhere), as TaskMint's:
 * ⌘1–⌘6 open the pages in sidebar order, and ⌘, opens Settings (not in a
 * browser, which keeps it). They wait while a dialog or menu is open.
 */

import { useEffect, useRef } from 'react';
import { VIEWS, SidebarView } from '../navigation/views';
import { useNavigation } from '../contexts/NavigationContext';

export function isMacPlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/** "⌘" on macOS, "Ctrl+" elsewhere: shortcut hints read "⌘1" / "Ctrl+1". */
export function modifierLabel(mac = isMacPlatform()): string {
  return mac ? '⌘' : 'Ctrl+';
}

/** The shortcut hint for a page ("⌘1"). */
export function viewShortcut(view: SidebarView, mac = isMacPlatform()): string {
  return `${modifierLabel(mac)}${VIEWS.indexOf(view) + 1}`;
}

type KeyPress = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat'>;

/** The page a key press opens, if it's one of the shortcuts. */
export function shortcutView(event: KeyPress, mac: boolean, inBrowser: boolean): SidebarView | null {
  const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!modifier || event.altKey || event.shiftKey || event.repeat) return null;
  if (event.key === ',' && !inBrowser) return 'settings';
  const index = Number(event.key) - 1;
  return Number.isInteger(index) && index >= 0 && index < VIEWS.length ? VIEWS[index] : null;
}

/** Whether a dialog or menu is open, so a shortcut would act behind it. */
function somethingOnTop(): boolean {
  return document.querySelector('[role="dialog"], [role="menu"], [role="presentation"]') !== null;
}

export function useKeyboardShortcuts(inBrowser: boolean): void {
  const { navigate } = useNavigation();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    const mac = isMacPlatform();
    const onKeyDown = (event: KeyboardEvent) => {
      const view = shortcutView(event, mac, inBrowser);
      if (view === null || somethingOnTop()) return;
      event.preventDefault();
      navigateRef.current(view);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inBrowser]);
}
