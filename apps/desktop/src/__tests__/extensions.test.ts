// Adapted from TaskMint apps/desktop/src/__tests__/extensions.test.ts @ 94318ec.
import { describe, it, expect, vi } from 'vitest';
import { desktopExtensions } from '../extensions';
import { AboutUpdates } from '../about/AboutUpdates';
import { DesktopBackground } from '../Background';
import { TroubleshootingSection } from '../settings/TroubleshootingSection';
import { UpdatesSection } from '../settings/UpdatesSection';
import { UpdatePrompt } from '../UpdatePrompt';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

describe("the Tauri app's extensions", () => {
  it('add the Updates and Troubleshooting sections, the update check, and About’s word on updates', () => {
    const desktop = desktopExtensions({ runtime: 'desktop' });
    expect(desktop.settingsSections).toEqual([
      { id: 'updates', label: 'Updates', Section: UpdatesSection },
      { id: 'troubleshooting', label: 'Troubleshooting', Section: TroubleshootingSection },
    ]);
    expect(desktop.Background).toBe(DesktopBackground);
    expect(desktop.AboutUpdates).toBe(AboutUpdates);
  });

  it('are the same on a phone, which downloads its updates, without the log’s section or the menus', () => {
    const phone = desktopExtensions({ runtime: 'mobile' });
    expect(phone.settingsSections).toEqual([{ id: 'updates', label: 'Updates', Section: UpdatesSection }]);
    // The update check alone: there are no menus to ask for one
    expect(phone.Background).toBe(UpdatePrompt);
    expect(phone.AboutUpdates).toBe(AboutUpdates);
  });
});
