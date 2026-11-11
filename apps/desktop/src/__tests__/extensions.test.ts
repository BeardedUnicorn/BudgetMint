// Adapted from TaskMint apps/desktop/src/__tests__/extensions.test.ts @ 1623bee.
import { describe, it, expect, vi } from 'vitest';
import { desktopExtensions } from '../extensions';
import { DesktopBackground } from '../Background';
import { TroubleshootingSection } from '../settings/TroubleshootingSection';
import { UpdatesSection } from '../settings/UpdatesSection';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

describe("the desktop's extensions", () => {
  it('add the Updates and Troubleshooting sections, and the update check and menus', () => {
    const desktop = desktopExtensions({ runtime: 'desktop' });
    expect(desktop.settingsSections).toEqual([
      { id: 'updates', label: 'Updates', Section: UpdatesSection },
      { id: 'troubleshooting', label: 'Troubleshooting', Section: TroubleshootingSection },
    ]);
    expect(desktop.Background).toBe(DesktopBackground);
  });

  it('add nothing on a phone or tablet, which has no updater or menus', () => {
    expect(desktopExtensions({ runtime: 'mobile' })).toEqual({});
  });
});
