/**
 * The client's Shell in a browser. There's no tray, and reminders come only
 * while a BudgetMint tab is open: each waits on a timer and shows as a web
 * notification at its time. Google sign-in is Firebase's popup.
 */

import type { ScheduledNotification, Shell } from '@budgetmint/client/shell';

/** The longest a browser's timer waits (about 24.8 days); a later reminder waits in steps. */
export const MAX_TIMER_MS = 2 ** 31 - 1;

export function createWebShell(clock: () => number = Date.now): Shell {
  let timers: ReturnType<typeof setTimeout>[] = [];
  let waiting: ScheduledNotification[] = [];
  /** Shown already (this page): one missed while closed stays in the list, and isn't shown again. */
  const shown = new Set<number>();

  /** Shows `reminder` now, once, if notifications are allowed. Clicking it brings the tab forward. */
  function show({ id, title, body }: ScheduledNotification): void {
    if (shown.has(id) || Notification.permission !== 'granted') return;
    shown.add(id);
    const notification = new Notification(title, { body, tag: String(id), icon: '/budgetmint-icon.png' });
    notification.onclick = () => window.focus();
  }

  /** Waits for `reminder`'s time, in steps when it's further off than a timer can wait. */
  function arm(reminder: ScheduledNotification): void {
    const wait = reminder.atMs - clock();
    timers.push(
      wait > MAX_TIMER_MS ? setTimeout(() => arm(reminder), MAX_TIMER_MS) : setTimeout(() => show(reminder), wait)
    );
  }

  /** Starts every waiting reminder's timer afresh, from the time it is now. */
  function rearm(): void {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
    if (!('Notification' in window)) return;
    for (const reminder of waiting) arm(reminder);
  }
  // A browser's timers stop while the computer sleeps (and slow in a hidden
  // tab), so they'd fire late by as long: back in view, they start from now
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') rearm();
  });

  return {
    capabilities: { runtime: 'web' },
    platform: {
      notifications: {
        async request() {
          if (!('Notification' in window)) return false;
          if (Notification.permission !== 'default') return Notification.permission === 'granted';
          return (await Notification.requestPermission()) === 'granted';
        },
        granted: async () => 'Notification' in window && Notification.permission === 'granted',
        async show(title, body) {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body, icon: '/budgetmint-icon.png' });
          }
        },
        async schedule(list) {
          waiting = list;
          rearm();
        },
        firesWhenClosed: false,
      },
    },
  };
}
