import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { command, createTauriShell, subscribe } from '../tauriShell';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const mockInvoke = vi.mocked(invoke);
const sent = () => mockInvoke.mock.calls.map(([, payload]) => payload);

afterEach(() => {
  delete window.BudgetMintSystemBars;
  delete window.BudgetMintSplash;
  delete window.BudgetMintGoogleSignIn;
  delete window.BudgetMintAnalytics;
  delete window.__budgetmintGoogleSignIn;
  delete window.__budgetmintInsets;
  delete window.BudgetMintScreen;
  delete window.BudgetMintLaunch;
  delete window.BudgetMintWidgets;
  delete window.__budgetmintLaunch;
});

describe('the Tauri shell', () => {
  it('runs every command through dispatch', async () => {
    mockInvoke.mockResolvedValueOnce({ runtime: 'desktop' });
    expect(await command('get_capabilities')).toEqual({ runtime: 'desktop' });
    expect(mockInvoke).toHaveBeenCalledWith('dispatch', { command: 'get_capabilities', args: {} });
  });

  it('on a desktop: notifications while it runs, the tray, and Google in the browser with a client', async () => {
    const shell = createTauriShell({ runtime: 'desktop' }, { clientId: 'id', clientSecret: 'secret' });
    const { notifications, tray, autostart, googleSignIn, systemBars, splashScreen, saveFile, analytics } =
      shell.platform;
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
    // No Google tag in a webview that can call every command
    expect(analytics).toBeUndefined();
    // Without a client, email and password only
    expect(createTauriShell({ runtime: 'desktop' }).platform.googleSignIn).toBeUndefined();
  });

  it('on a phone: alarms that come with the app closed, the save dialog, and none of the bridges without Android', async () => {
    const { platform } = createTauriShell({ runtime: 'mobile' }, { clientId: 'id', clientSecret: 'secret' });
    expect(platform.notifications.firesWhenClosed).toBe(true);
    expect(platform.tray).toBeUndefined();
    expect(platform.autostart).toBeUndefined();
    expect(platform.googleSignIn).toBeUndefined();
    expect(platform.systemBars).toBeUndefined();
    expect(platform.splashScreen).toBeUndefined();
    expect(platform.analytics).toBeUndefined();
    expect(platform.screenPrivacy).toBeUndefined();
    expect(platform.menu).toBeUndefined();
    expect(platform.widgets).toBeUndefined();
    // Android's document picker, through the same command; false when it's cancelled
    mockInvoke.mockResolvedValueOnce(false);
    expect(await platform.saveFile!('budget.csv', 'a,b', 'text/csv')).toBe(false);
    expect(sent()).toEqual([{ command: 'save_file', args: { name: 'budget.csv', text: 'a,b' } }]);
  });

  it("on Android: the status bar, the launch screen, Google's account picker and analytics", async () => {
    const bars = {
      setTheme: vi.fn(),
      topInset: vi.fn(() => 24),
      rightInset: vi.fn(() => 0),
      bottomInset: vi.fn(() => 16),
      leftInset: vi.fn(() => 0),
      keyboardInset: vi.fn(() => 0),
    };
    const splash = { hide: vi.fn() };
    const analytics = { setEnabled: vi.fn(), screen: vi.fn() };
    const picker = { start: vi.fn(() => window.__budgetmintGoogleSignIn!({ idToken: 'android-token' })) };
    window.BudgetMintSystemBars = bars;
    window.BudgetMintSplash = splash;
    window.BudgetMintGoogleSignIn = picker;
    window.BudgetMintAnalytics = analytics;
    const { platform } = createTauriShell({ runtime: 'mobile' });
    platform.systemBars!.setDark(true);
    platform.systemBars!.setDark(false);
    expect(bars.setTheme.mock.calls).toEqual([['dark'], ['light']]);
    // What the bars and the keyboard cover, which the webview doesn't tell the page
    expect(platform.systemBars!.insets()).toEqual({ top: 24, right: 0, bottom: 16, left: 0 });
    expect(platform.systemBars!.keyboardInset()).toBe(0);
    // MainActivity says when they change, to every listener still listening
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = platform.systemBars!.onInsetsChange(first);
    platform.systemBars!.onInsetsChange(second);
    bars.keyboardInset.mockReturnValue(320);
    window.__budgetmintInsets!();
    expect(platform.systemBars!.keyboardInset()).toBe(320);
    stopFirst();
    window.__budgetmintInsets!();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    platform.splashScreen!.hide();
    expect(splash.hide).toHaveBeenCalled();
    platform.analytics!.setEnabled(false);
    platform.analytics!.screen('overview');
    expect(analytics.setEnabled).toHaveBeenCalledWith(false);
    expect(analytics.screen).toHaveBeenCalledWith('overview');
    expect(await platform.googleSignIn!()).toBe('android-token');
    picker.start.mockImplementationOnce(() => window.__budgetmintGoogleSignIn!({ error: 'Cancelled' }));
    await expect(platform.googleSignIn!()).rejects.toBe('Cancelled');
  });

  it('on Android: screen privacy, the widgets, and what the app was opened for once the budget is open', async () => {
    let waiting = 'new-bill';
    const launch = {
      take: vi.fn(() => {
        const id = waiting;
        waiting = '';
        return id;
      }),
    };
    const screen = { isPrivate: vi.fn(() => true), setPrivate: vi.fn() };
    const widgets = { set: vi.fn() };
    window.BudgetMintScreen = screen;
    window.BudgetMintLaunch = launch;
    window.BudgetMintWidgets = widgets;
    const { platform } = createTauriShell({ runtime: 'mobile' });
    expect(platform.screenPrivacy!.isOn()).toBe(true);
    platform.screenPrivacy!.set(false);
    expect(screen.setPrivate).toHaveBeenCalledWith(false);
    platform.widgets!.set('{"days":[]}');
    expect(widgets.set).toHaveBeenCalledWith('{"days":[]}');

    // A shortcut started the app: its id waits for the budget (sign-in, loading)
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = platform.menu!.subscribe(first);
    window.__budgetmintLaunch!();
    expect(launch.take).not.toHaveBeenCalled();
    // The budget opens, and the listeners subscribing with it hear the id, once
    platform.menu!.setBudgetOpen(true);
    platform.menu!.subscribe(second);
    await Promise.resolve();
    expect(first).toHaveBeenCalledWith('new-bill');
    expect(second).toHaveBeenCalledWith('new-bill');
    // While it runs, MainActivity says when there's another; nothing waiting is nothing
    waiting = 'go-forecast';
    stopFirst();
    window.__budgetmintLaunch!();
    window.__budgetmintLaunch!();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second.mock.calls).toEqual([['new-bill'], ['go-forecast']]);
    // Signed out: the next one waits again
    platform.menu!.setBudgetOpen(false);
    await Promise.resolve();
    waiting = 'record';
    window.__budgetmintLaunch!();
    expect(second).toHaveBeenCalledTimes(2);
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
