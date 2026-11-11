import { useMenuCommands } from './menuCommands';
import { UpdatePrompt } from './UpdatePrompt';

/**
 * What the desktop runs behind the pages (the client's Background
 * extension), whatever the phase: the update check, and the menus' items.
 */
export function DesktopBackground() {
  useMenuCommands();
  return <UpdatePrompt />;
}
