/**
 * Reminders: core says which are coming in the next 30 days, this words
 * them and hands them to the shell to show at their times (Android
 * schedules them with the system; the desktop and the web show them while
 * the app runs). Asked again whenever the budget changes, so a bill paid
 * early stops reminding. Off on a device where the user turned them off.
 *
 * Where reminders come only while the app runs, the device keeps when it
 * last ran, and at launch also asks core for the ones it missed since
 * (the last day's at most): the shell shows those at once.
 */

import { useEffect, useState } from 'react';
import type { Reminder } from '@budgetmint/contracts';
import { useNotification } from '../contexts/NotificationContext';
import { useCoreQuery } from '../data/BudgetContext';
import { getShell } from '../shell';
import type { ScheduledNotification } from '../shell/types';
import { formatWeekday } from '../utils/dates';
import { formatCents } from '../utils/money';
import { readLocal, writeLocal } from '../utils/localStore';
import { useLocalStorage } from './useLocalStorage';

/** Whether this device shows reminders. */
export const REMINDERS_ON_KEY = 'remindersOn';
export const REMINDER_WINDOW_DAYS = 30;
export const MAX_SCHEDULED = 60;
/** When this device last ran (ms), kept every LAST_RAN_INTERVAL_MS while it does. */
export const LAST_RAN_KEY = 'remindersLastRan';
export const LAST_RAN_INTERVAL_MS = 30_000;

const when = (days: number) => (days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);
const since = (days: number) => (days === -1 ? 'yesterday' : `${-days} days ago`);

/** A reminder in words. */
export function reminderText(reminder: Reminder): { title: string; body: string } {
  const amount = formatCents(reminder.amountCents);
  const day = formatWeekday(reminder.due);
  switch (reminder.kind) {
    case 'bill':
      return {
        title:
          reminder.daysLeft < 0
            ? `${reminder.name} was due ${since(reminder.daysLeft)}`
            : `${reminder.name} is due ${when(reminder.daysLeft)}`,
        body: reminder.autopay ? `${amount} goes out on autopay, ${day}.` : `${amount}, ${day}.`,
      };
    case 'income':
      return {
        title:
          reminder.daysLeft < 0
            ? `${reminder.name} was to come in ${since(reminder.daysLeft)}`
            : `${reminder.name} comes in ${when(reminder.daysLeft)}`,
        body: `${amount}, ${day}.`,
      };
    case 'lowBalance':
      return reminder.short
        ? { title: 'Your balance goes below zero', body: `It’s ${amount} on ${day}.` }
        : { title: 'Your balance gets low', body: `It’s ${amount} on ${day}.` };
  }
}

export function scheduled(reminders: Reminder[]): ScheduledNotification[] {
  return reminders.map(reminder => ({ id: reminder.id, atMs: reminder.atMs, ...reminderText(reminder) }));
}

export function useReminders(): void {
  const [on] = useLocalStorage(REMINDERS_ON_KEY, true);
  // When it last ran, read once at launch (a phone's system showed the
  // missed ones itself)
  const [missedSince] = useState(() =>
    getShell().platform.notifications.firesWhenClosed ? null : readLocal<number | null>(LAST_RAN_KEY, null)
  );
  useEffect(() => {
    const ran = () => writeLocal<number | null>(LAST_RAN_KEY, Date.now(), null);
    ran();
    const timer = window.setInterval(ran, LAST_RAN_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);
  // On, but never allowed: the system asks where it can on its own (Android);
  // a browser asks only at a click, so a toast offers one
  const { showWarning } = useNotification();
  useEffect(() => {
    if (!on) return;
    const { notifications } = getShell().platform;
    const failed = (error: unknown) => console.warn('Failed to ask about notifications:', error);
    if (!notifications.granted) {
      if (notifications.firesWhenClosed) notifications.request().catch(failed);
      return;
    }
    notifications
      .granted()
      .then(granted => {
        if (granted) return;
        showWarning('Reminders are on, but this browser hasn’t allowed BudgetMint’s notifications.', {
          actions: [{ label: 'Allow', onClick: () => notifications.request().catch(failed) }],
        });
      })
      .catch(failed);
  }, [on, showWarning]);
  const reminders = useCoreQuery('get_reminders', {
    windowDays: REMINDER_WINDOW_DAYS,
    max: MAX_SCHEDULED,
    ...(missedSince === null ? {} : { missedSinceMs: missedSince }),
  });
  const list = on ? scheduled(reminders) : [];
  const key = JSON.stringify(list);

  useEffect(() => {
    getShell()
      .platform.notifications.schedule(JSON.parse(key))
      .catch(error => console.warn('Failed to schedule reminders:', error));
  }, [key]);
  // Signed out (or the data unreachable): the account's reminders go with it
  useEffect(
    () => () => {
      getShell()
        .platform.notifications.schedule([])
        .catch(error => console.warn('Failed to clear reminders:', error));
    },
    []
  );
}
