/**
 * A shell for tests: every platform member a vi.fn, the ones a test asks
 * to do without left out. `clickMenu` is a click on a menu bar or tray
 * item the app does, and `changeInsets` Android's bars or keyboard changing.
 */

import { vi } from 'vitest';
import type { Platform, Shell } from '../shell/types';

export type FakePlatform = {
  [K in keyof Required<Platform>]: Required<Platform>[K];
};

export function createFakeShell(
  options: { runtime?: Shell['capabilities']['runtime']; without?: (keyof Platform)[]; firesWhenClosed?: boolean } = {}
): Shell & { platform: FakePlatform; clickMenu: (id: string) => void; changeInsets: () => void } {
  const menuListeners = new Set<(id: string) => void>();
  const insetListeners = new Set<() => void>();
  const platform: FakePlatform = {
    notifications: {
      request: vi.fn(async () => true),
      schedule: vi.fn(async () => undefined),
      show: vi.fn(async () => undefined),
      firesWhenClosed: options.firesWhenClosed ?? false,
    },
    googleSignIn: vi.fn(async () => 'google-id-token'),
    autostart: { isEnabled: vi.fn(async () => false), setEnabled: vi.fn(async () => undefined) },
    tray: { setStatus: vi.fn(async () => undefined) },
    systemBars: {
      setDark: vi.fn(),
      insets: vi.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
      keyboardInset: vi.fn(() => 0),
      onInsetsChange: vi.fn((listener: () => void) => {
        insetListeners.add(listener);
        return () => {
          insetListeners.delete(listener);
        };
      }),
    },
    splashScreen: { hide: vi.fn() },
    saveFile: vi.fn(async () => true),
    analytics: { setEnabled: vi.fn(), screen: vi.fn() },
    menu: {
      subscribe: vi.fn((listener: (id: string) => void) => {
        menuListeners.add(listener);
        return () => menuListeners.delete(listener);
      }),
      setBudgetOpen: vi.fn(),
    },
    screenPrivacy: { isOn: vi.fn(() => false), set: vi.fn() },
    widgets: { set: vi.fn() },
  };
  for (const member of options.without ?? []) delete (platform as Partial<FakePlatform>)[member];
  const clickMenu = (id: string) => {
    for (const listener of menuListeners) listener(id);
  };
  const changeInsets = () => {
    for (const listener of [...insetListeners]) listener();
  };
  return { capabilities: { runtime: options.runtime ?? 'desktop' }, platform, clickMenu, changeInsets };
}
