import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { DesktopBackground } from '../Background';
import { CHECK_FOR_UPDATES } from '../menuCommands';
import { createTauriShell, MENU_COMMAND } from '../tauriShell';
import { resetUpdatesForTest } from '../updates';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

/** The Tauri events listened for, by name. */
const listening = new Map<string, EventCallback<unknown>>();

function emit(event: string, payload: unknown = null) {
  act(() => listening.get(event)?.({ event, id: 0, payload }));
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

describe("the desktop's background", () => {
  it("shows the update check, and checks when the menus' Check for Updates… is clicked", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    const { unmount } = render(<DesktopBackground />);
    await vi.waitFor(() => expect(listening.size).toBe(1));

    emit(CHECK_FOR_UPDATES);
    expect(invoke).toHaveBeenCalledWith('dispatch', { command: 'check_for_update', args: {} });
    expect(await screen.findByRole('dialog', { name: 'BudgetMint is up to date' })).toBeInTheDocument();

    unmount();
    expect(listening.size).toBe(0);
  });
});

describe("the shell's menu", () => {
  it("passes the menus' other items to the client, and says when the budget opens and closes", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { menu } = createTauriShell({ runtime: 'desktop' }).platform;
    const clicked = vi.fn();
    const stop = menu!.subscribe(clicked);
    await vi.waitFor(() => expect(listening.has(MENU_COMMAND)).toBe(true));
    emit(MENU_COMMAND, 'go-bills');
    expect(clicked).toHaveBeenCalledWith('go-bills');
    stop();
    expect(listening.has(MENU_COMMAND)).toBe(false);

    menu!.setBudgetOpen(true);
    expect(invoke).toHaveBeenCalledWith('dispatch', { command: 'set_menu_state', args: { budgetOpen: true } });
    // The menus can't change: said in the log, and the app goes on
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(invoke).mockRejectedValueOnce('no menu bar');
    menu!.setBudgetOpen(false);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('Failed to change the menus:', 'no menu bar'));
  });

  it('is only on a desktop', () => {
    expect(createTauriShell({ runtime: 'mobile' }).platform.menu).toBeUndefined();
  });
});
