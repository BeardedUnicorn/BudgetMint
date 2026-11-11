/**
 * Saving a file the app made (the budget's backup and spreadsheet): the
 * shell's own way where it has one, a download in a browser.
 */

import type { Shell } from '../shell/types';

/** Whether this shell can save a file at all. */
export const canSaveFiles = (shell: Shell) =>
  shell.platform.saveFile !== undefined || shell.capabilities.runtime === 'web';

/** Saves `text` as `name`; whether it was (the user may cancel the shell's dialog). */
export async function saveFile(shell: Shell, name: string, text: string, type: string): Promise<boolean> {
  if (shell.platform.saveFile) return shell.platform.saveFile(name, text, type);
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}
