/**
 * The shell this page runs in, set once by startClient (like TaskMint's
 * backend registry, there's one per page).
 */

import type { Shell } from './types';

export type * from './types';

let current: Shell | null = null;

export function setShell(shell: Shell): void {
  current = shell;
}

export function getShell(): Shell {
  if (!current) throw new Error('No shell: startClient sets it');
  return current;
}
