import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebShell, MAX_TIMER_MS } from '../webShell';

/** A stand-in for the browser's Notification, with the permission a test sets. */
class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted');
  static shown: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  constructor(
    readonly title: string,
    readonly options: NotificationOptions
  ) {
    FakeNotification.shown.push(this);
  }
}

const NOW = Date.UTC(2026, 10, 10, 18);
const reminder = (id: number, atMs: number) => ({ id, atMs, title: `Reminder ${id}`, body: 'Due' });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  FakeNotification.permission = 'granted';
  FakeNotification.shown = [];
  vi.stubGlobal('Notification', FakeNotification);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the web shell', () => {
  it('is a browser: no tray, and reminders only while a tab is open', () => {
    const { capabilities, platform } = createWebShell();
    expect(capabilities.runtime).toBe('web');
    expect(platform.tray).toBeUndefined();
    expect(platform.googleSignIn).toBeUndefined();
    expect(platform.notifications.firesWhenClosed).toBe(false);
    expect(platform.analytics).toBeUndefined();
  });

  it('carries the build’s usage analytics, when it has them', () => {
    const analytics = { setEnabled: vi.fn(), screen: vi.fn() };
    expect(createWebShell(Date.now, analytics).platform.analytics).toBe(analytics);
  });

  it('asks for permission only when the browser hasn’t been answered', async () => {
    const { notifications } = createWebShell().platform;
    expect(await notifications.request()).toBe(true);
    FakeNotification.permission = 'denied';
    expect(await notifications.request()).toBe(false);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    FakeNotification.permission = 'default';
    expect(await notifications.request()).toBe(true);
    FakeNotification.requestPermission.mockResolvedValueOnce('denied');
    expect(await notifications.request()).toBe(false);
  });

  it('shows each reminder at its time, and a new list replaces the old', async () => {
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    const { notifications } = createWebShell().platform;
    await notifications.schedule([reminder(1, NOW + 1000), reminder(2, NOW + 5000)]);
    vi.advanceTimersByTime(1000);
    expect(FakeNotification.shown.map(n => [n.title, n.options.body, n.options.tag])).toEqual([
      ['Reminder 1', 'Due', '1'],
    ]);
    FakeNotification.shown[0].onclick!();
    expect(focus).toHaveBeenCalled();
    // The budget changed: reminder 2 is gone
    await notifications.schedule([reminder(3, NOW + 6000)]);
    vi.advanceTimersByTime(5000);
    expect(FakeNotification.shown.map(n => n.title)).toEqual(['Reminder 1', 'Reminder 3']);
  });

  it('shows one that was due already at once, and only once however often it comes again', async () => {
    const { notifications } = createWebShell().platform;
    await notifications.schedule([reminder(1, NOW - 60_000)]);
    vi.advanceTimersByTime(0);
    await notifications.schedule([reminder(1, NOW - 60_000)]);
    vi.advanceTimersByTime(0);
    expect(FakeNotification.shown.map(n => n.title)).toEqual(['Reminder 1']);
  });

  it('shows a test notification at once, when allowed', async () => {
    const { notifications } = createWebShell().platform;
    await notifications.show('A test', 'It works');
    expect(FakeNotification.shown.map(n => [n.title, n.options.body])).toEqual([['A test', 'It works']]);
    FakeNotification.permission = 'denied';
    await notifications.show('Another', 'Blocked');
    expect(FakeNotification.shown).toHaveLength(1);
    vi.unstubAllGlobals();
    await createWebShell().platform.notifications.show('None', 'No notifications here');
  });

  it('says whether notifications are allowed without asking', async () => {
    FakeNotification.requestPermission.mockClear();
    const { notifications } = createWebShell().platform;
    expect(await notifications.granted!()).toBe(true);
    FakeNotification.permission = 'default';
    expect(await notifications.granted!()).toBe(false);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('shows a reminder on time after the computer slept through its timer', async () => {
    let now = NOW;
    const { notifications } = createWebShell(() => now).platform;
    await notifications.schedule([reminder(1, NOW + 60_000)]);
    // Asleep for an hour: the clock moved on, the timer didn't
    now += 3_600_000;
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(0);
    expect(FakeNotification.shown).toHaveLength(0);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(0);
    expect(FakeNotification.shown.map(n => n.title)).toEqual(['Reminder 1']);
  });

  it('waits in steps for a reminder further off than a timer can wait', async () => {
    let now = NOW;
    const { notifications } = createWebShell(() => now).platform;
    await notifications.schedule([reminder(1, NOW + MAX_TIMER_MS + 1000)]);
    now += MAX_TIMER_MS;
    vi.advanceTimersByTime(MAX_TIMER_MS);
    expect(FakeNotification.shown).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(FakeNotification.shown).toHaveLength(1);
  });

  it('shows nothing once notifications are blocked, and does without them where there are none', async () => {
    const { notifications } = createWebShell().platform;
    await notifications.schedule([reminder(1, NOW + 1000)]);
    FakeNotification.permission = 'denied';
    vi.advanceTimersByTime(1000);
    expect(FakeNotification.shown).toHaveLength(0);

    vi.unstubAllGlobals();
    const without = createWebShell().platform.notifications;
    expect(await without.request()).toBe(false);
    await without.schedule([reminder(2, NOW + 1000)]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
