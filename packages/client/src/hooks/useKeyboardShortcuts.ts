/**
 * App-wide keyboard shortcuts (⌘ on macOS, Ctrl elsewhere), as TaskMint's:
 * ⌘1–⌘8 open the pages in sidebar order, and ⌘, opens Settings. Not in a
 * browser, which keeps them: ⌘N adds a bill (income, on its page), ⇧⌘N
 * income, ⌘B updates the balance, and ⌘/ lists them all. They wait while
 * a dialog or menu is open. The macOS menu bar shows the same keys.
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

export type ShortcutAction = 'add' | 'addIncome' | 'balance' | 'list';

/** The other shortcuts: adding, the balance, and the list of them all (none in a browser). */
export function shortcutAction(event: KeyPress, mac: boolean, inBrowser: boolean): ShortcutAction | null {
  const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!modifier || event.altKey || event.repeat || inBrowser) return null;
  const key = event.key.toLowerCase();
  if (event.shiftKey) return key === 'n' ? 'addIncome' : null;
  return key === 'n' ? 'add' : key === 'b' ? 'balance' : key === '/' ? 'list' : null;
}

/** Whether a dialog or menu is open, so a shortcut (or the menu bar) would act behind it. */
export function somethingOnTop(): boolean {
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
      else if (action === 'addIncome') navigation.navigate('income', { add: true });
      else if (action === 'balance') navigation.navigate('overview', { open: 'balance' });
      else onList();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inBrowser]);
}
