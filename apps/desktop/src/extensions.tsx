// Adapted from TaskMint apps/desktop/src/extensions.tsx @ 94318ec.
import type { AppExtensions } from '@budgetmint/client/start';
import type { Capabilities } from '@budgetmint/client/shell';
import { AboutUpdates } from './about/AboutUpdates';
import { DesktopBackground } from './Background';
import { TroubleshootingSection } from './settings/TroubleshootingSection';
import { UpdatesSection } from './settings/UpdatesSection';
import { UpdatePrompt } from './UpdatePrompt';

/**
 * The Tauri app's own parts of the client: the Updates section, the update
 * check behind the pages, and About's word on updates. A phone or tablet
 * has them too: it downloads the new version for Android to install,
 * instead of installing it (updates.ts). Only a desktop has the
 * Troubleshooting section (a phone's log goes to the system's) and the
 * menus' Check for Updates….
 */
export function desktopExtensions({ runtime }: Capabilities): AppExtensions {
  const updates = { id: 'updates', label: 'Updates', Section: UpdatesSection };
  if (runtime === 'mobile') {
    return { settingsSections: [updates], Background: UpdatePrompt, AboutUpdates };
  }
  return {
    settingsSections: [updates, { id: 'troubleshooting', label: 'Troubleshooting', Section: TroubleshootingSection }],
    Background: DesktopBackground,
    AboutUpdates,
  };
}
