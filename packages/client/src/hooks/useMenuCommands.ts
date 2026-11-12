/**
 * The desktop's menu bar and tray items that the app does (the shell's
 * `menu`): their ids, which the Rust side's menu.rs gives them too, and a
 * hook that acts on their clicks.
 */

import { useEffect, useRef } from 'react';
import type { SidebarView } from '../navigation/views';
import { getShell } from '../shell';

export const MENU = {
  about: 'about',
  settings: 'settings',
  signOut: 'sign-out',
  newBill: 'new-bill',
  newIncome: 'new-income',
  updateBalance: 'update-balance',
  importStatement: 'import-statement',
  downloadBackup: 'download-backup',
  downloadSpreadsheet: 'download-spreadsheet',
  shortcuts: 'shortcuts',
  toggleSidebar: 'toggle-sidebar',
} as const;

/** The Go menu's item for a page: `go-overview`, `go-bills`… */
export const goTo = (view: SidebarView) => `go-${view}`;

/** While mounted, a click on one of `handlers`' ids does it (the others are another caller's). */
export function useMenuCommands(handlers: Record<string, () => void>): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => getShell().platform.menu?.subscribe(id => latest.current[id]?.()), []);
}
