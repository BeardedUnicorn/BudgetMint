import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { DesktopBackground } from '../Background';
import { CHECK_FOR_UPDATES, isMac, OPEN_SETTINGS, openSettings, settingsShortcut } from '../menuCommands';
import { resetUpdatesForTest } from '../updates';
// The client's own shortcut: the press the menus make must be the one it opens Settings on
import { shortcutView } from '../../../../packages/client/src/hooks/useKeyboardShortcuts';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

/** The Tauri events listened for, by name. */
const listening = new Map<string, EventCallback<unknown>>();

function emit(event: string) {
  act(() => listening.get(event)?.({ event, id: 0, payload: null }));
}

beforeEach(() => {
  localStorage.clear();
  resetUpdatesForTest();
  listening.clear();
  vi.mocked(listen).mockImplementation(async (event, handler) => {
    listening.set(event, handler as EventCallback<unknown>);
    return () => listening.delete(event);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The key presses that reach the window while `run` runs. */
function pressed(run: () => void): KeyboardEvent[] {
  const presses: KeyboardEvent[] = [];
  const onKeyDown = (event: KeyboardEvent) => presses.push(event);
  window.addEventListener('keydown', onKeyDown);
  run();
  window.removeEventListener('keydown', onKeyDown);
  return presses;
}

describe("the menus' Settings…", () => {
  it("presses the client's Settings shortcut, ⌘, on macOS and Ctrl+, elsewhere", () => {
    for (const mac of [true, false]) {
      const press = new KeyboardEvent('keydown', settingsShortcut(mac));
      expect(shortcutView(press, mac, false)).toBe('settings');
      // The other platform's press is no shortcut
      expect(shortcutView(press, !mac, false)).toBeNull();
    }
  });

  it('presses it on the window, with the modifier of the platform it runs on', () => {
    const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    expect(isMac()).toBe(true);
    const [mac] = pressed(openSettings);
    expect(mac).toMatchObject({ key: ',', metaKey: true, ctrlKey: false, cancelable: true });

    platform.mockReturnValue('Win32');
    expect(isMac()).toBe(false);
    const [windows] = pressed(openSettings);
    expect(windows).toMatchObject({ key: ',', metaKey: false, ctrlKey: true });

    // No platform: the user agent says
    platform.mockReturnValue('');
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    expect(isMac()).toBe(true);
  });
});

describe("the desktop's background", () => {
  it('shows the update check, and acts on the menus while mounted', async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    const { unmount } = render(<DesktopBackground />);
    await vi.waitFor(() => expect(listening.size).toBe(2));

    expect(pressed(() => emit(OPEN_SETTINGS))).toHaveLength(1);

    emit(CHECK_FOR_UPDATES);
    expect(invoke).toHaveBeenCalledWith('dispatch', { command: 'check_for_update', args: {} });
    expect(await screen.findByRole('dialog', { name: 'BudgetMint is up to date' })).toBeInTheDocument();

    unmount();
    expect(listening.size).toBe(0);
  });
});
