import type { AppExtensions } from '@budgetmint/client/start';
import type { Capabilities } from '@budgetmint/client/shell';
import { DesktopBackground } from './Background';
import { TroubleshootingSection } from './settings/TroubleshootingSection';
import { UpdatesSection } from './settings/UpdatesSection';

/**
 * The desktop's own parts of the client: the Updates and Troubleshooting
 * sections, and the update check and menus behind the pages. A phone or
 * tablet has none of them: its build has no updater or menus, and its log
 * goes to the system's.
 */
export function desktopExtensions({ runtime }: Capabilities): AppExtensions {
  if (runtime === 'mobile') return {};
  return {
    settingsSections: [
      { id: 'updates', label: 'Updates', Section: UpdatesSection },
      { id: 'troubleshooting', label: 'Troubleshooting', Section: TroubleshootingSection },
    ],
    Background: DesktopBackground,
  };
}
