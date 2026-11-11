/**
 * A shell for tests: every platform member a vi.fn, the ones a test asks
 * to do without left out.
 */

import { vi } from 'vitest';
import type { Platform, Shell } from '../shell/types';

export type FakePlatform = {
  [K in keyof Required<Platform>]: Required<Platform>[K];
};

export function createFakeShell(
  options: { runtime?: Shell['capabilities']['runtime']; without?: (keyof Platform)[]; firesWhenClosed?: boolean } = {}
): Shell & { platform: FakePlatform } {
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
    systemBars: { setDark: vi.fn() },
    splashScreen: { hide: vi.fn() },
  };
  for (const member of options.without ?? []) delete (platform as Partial<FakePlatform>)[member];
  return { capabilities: { runtime: options.runtime ?? 'desktop' }, platform };
}
