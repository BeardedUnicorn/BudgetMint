import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { command, createTauriShell, subscribe } from '../tauriShell';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const mockInvoke = vi.mocked(invoke);
const sent = () => mockInvoke.mock.calls.map(([, payload]) => payload);

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  delete window.BudgetMintSystemBars;
  delete window.BudgetMintSplash;
  delete window.BudgetMintGoogleSignIn;
  delete window.__budgetmintGoogleSignIn;
});

describe('the Tauri shell', () => {
  it('runs every command through dispatch', async () => {
    mockInvoke.mockResolvedValueOnce({ runtime: 'desktop' });
    expect(await command('get_capabilities')).toEqual({ runtime: 'desktop' });
    expect(mockInvoke).toHaveBeenCalledWith('dispatch', { command: 'get_capabilities', args: {} });
  });

  it('on a desktop: notifications while it runs, the tray, and Google in the browser with a client', async () => {
    const shell = createTauriShell({ runtime: 'desktop' }, { clientId: 'id', clientSecret: 'secret' });
    const { notifications, tray, autostart, googleSignIn, systemBars, splashScreen, saveFile } = shell.platform;
    expect(notifications.firesWhenClosed).toBe(false);
    await notifications.request();
    await notifications.schedule([{ id: 1, atMs: 2, title: 'Rent', body: '$1' }]);
    await notifications.show('A test', 'It works');
    await tray!.setStatus(['Today: $1.00']);
    await autostart!.isEnabled();
    await autostart!.setEnabled(true);
    mockInvoke.mockResolvedValueOnce({ idToken: 'token' });
    expect(await googleSignIn!()).toBe('token');
    mockInvoke.mockResolvedValueOnce(true);
    expect(await saveFile!('budget.json', '{}', 'application/json')).toBe(true);
    expect(sent()).toEqual([
      { command: 'request_notifications', args: {} },
      { command: 'schedule_reminders', args: { reminders: [{ id: 1, atMs: 2, title: 'Rent', body: '$1' }] } },
      { command: 'show_notification', args: { title: 'A test', body: 'It works' } },
      { command: 'set_tray_status', args: { lines: ['Today: $1.00'] } },
      { command: 'get_autostart', args: {} },
      { command: 'set_autostart', args: { enabled: true } },
      { command: 'google_sign_in', args: { clientId: 'id', clientSecret: 'secret' } },
      { command: 'save_file', args: { name: 'budget.json', text: '{}' } },
    ]);
    expect(systemBars).toBeUndefined();
    expect(splashScreen).toBeUndefined();
    // Without a client, email and password only
    expect(createTauriShell({ runtime: 'desktop' }).platform.googleSignIn).toBeUndefined();
  });

  it('on a phone: alarms that come with the app closed, and none of the bridges without Android', () => {
    const { platform } = createTauriShell({ runtime: 'mobile' }, { clientId: 'id', clientSecret: 'secret' });
    expect(platform.notifications.firesWhenClosed).toBe(true);
    expect(platform.tray).toBeUndefined();
    expect(platform.autostart).toBeUndefined();
    expect(platform.googleSignIn).toBeUndefined();
    expect(platform.systemBars).toBeUndefined();
    expect(platform.splashScreen).toBeUndefined();
    // No save dialog: the client says to save the files elsewhere
    expect(platform.saveFile).toBeUndefined();
  });

  it("on Android: the status bar, the launch screen and Google's account picker", async () => {
    const bars = { setTheme: vi.fn() };
    const splash = { hide: vi.fn() };
    const picker = { start: vi.fn(() => window.__budgetmintGoogleSignIn!({ idToken: 'android-token' })) };
    window.BudgetMintSystemBars = bars;
    window.BudgetMintSplash = splash;
    window.BudgetMintGoogleSignIn = picker;
    const { platform } = createTauriShell({ runtime: 'mobile' });
    platform.systemBars!.setDark(true);
    platform.systemBars!.setDark(false);
    expect(bars.setTheme.mock.calls).toEqual([['dark'], ['light']]);
    platform.splashScreen!.hide();
    expect(splash.hide).toHaveBeenCalled();
    expect(await platform.googleSignIn!()).toBe('android-token');
    picker.start.mockImplementationOnce(() => window.__budgetmintGoogleSignIn!({ error: 'Cancelled' }));
    await expect(platform.googleSignIn!()).rejects.toBe('Cancelled');
  });
});

describe('Tauri events', () => {
  it('reach the handler, and stop when unsubscribed', async () => {
    const stop = vi.fn();
    let deliver: (payload: number) => void = () => undefined;
    vi.mocked(listen).mockImplementationOnce(async (_event, handler) => {
      deliver = payload => handler({ event: 'e', id: 0, payload });
      return stop;
    });
    const seen = vi.fn();
    const unsubscribe = subscribe<number>('e', seen);
    await Promise.resolve();
    deliver(7);
    expect(seen).toHaveBeenCalledWith(7);
    unsubscribe();
    expect(stop).toHaveBeenCalled();
  });

  it('are let go once they register when unsubscribed first, and a failure is logged', async () => {
    const stop = vi.fn();
    vi.mocked(listen).mockImplementationOnce(async () => stop);
    subscribe('e', vi.fn())();
    await vi.waitFor(() => expect(stop).toHaveBeenCalled());

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(listen).mockRejectedValueOnce(new Error('no'));
    subscribe('f', vi.fn());
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Failed to listen for f:', expect.any(Error)));
    error.mockRestore();
  });
});
