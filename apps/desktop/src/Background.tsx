import { useCheckForUpdatesCommand } from './menuCommands';
import { UpdatePrompt } from './UpdatePrompt';

/**
 * What the desktop runs behind the pages (the client's Background
 * extension), whatever the phase: the update check, from the menus too.
 */
export function DesktopBackground() {
  useCheckForUpdatesCommand();
  return <UpdatePrompt />;
}
