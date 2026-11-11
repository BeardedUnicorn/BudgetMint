/**
 * App-wide keyboard shortcuts (⌘ on macOS, Ctrl elsewhere), as TaskMint's:
 * ⌘1–⌘8 open the pages in sidebar order, and ⌘, opens Settings. Not in a
 * browser, which keeps them: ⌘N adds a bill (income, on its page), and ⌘/
 * lists them all. They wait while a dialog or menu is open.
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

/** The other shortcuts: adding, and the list of them all (neither in a browser). */
export function shortcutAction(event: KeyPress, mac: boolean, inBrowser: boolean): 'add' | 'list' | null {
  const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!modifier || event.altKey || event.shiftKey || event.repeat || inBrowser) return null;
  return event.key.toLowerCase() === 'n' ? 'add' : event.key === '/' ? 'list' : null;
}

/** Whether a dialog or menu is open, so a shortcut would act behind it. */
function somethingOnTop(): boolean {
  return document.querySelector('[role="dialog"], [role="menu"], [role="presentation"]') !== null;
}

/** `onList`: ⌘/ was pressed (the list is the caller's to show). */
export function useKeyboardShortcuts(inBrowser: boolean, onList: () => void): void {
  const navigation = useNavigation();
  const latest = useRef({ navigation, onList });
  latest.current = { navigation, onList };

  useEffect(() => {
    const mac = isMacPlatform();
    const onKeyDown = (event: KeyboardEvent) => {
      const view = shortcutView(event, mac, inBrowser);
      const action = view === null ? shortcutAction(event, mac, inBrowser) : null;
      if ((view === null && action === null) || somethingOnTop()) return;
      event.preventDefault();
      const { navigation, onList } = latest.current;
      if (view !== null) navigation.navigate(view);
      // Income on its own page; a bill anywhere else
      else if (action === 'add') navigation.navigate(navigation.view === 'income' ? 'income' : 'bills', { add: true });
      else onList();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inBrowser]);
}
