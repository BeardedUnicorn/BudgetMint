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

  return {
    capabilities: { runtime: 'web' },
    platform: {
      notifications: {
        async request() {
          if (!('Notification' in window)) return false;
          if (Notification.permission !== 'default') return Notification.permission === 'granted';
          return (await Notification.requestPermission()) === 'granted';
        },
        async schedule(list) {
          for (const timer of timers) clearTimeout(timer);
          timers = [];
          if (!('Notification' in window)) return;
          for (const reminder of list) arm(reminder);
        },
        firesWhenClosed: false,
      },
    },
  };
}
