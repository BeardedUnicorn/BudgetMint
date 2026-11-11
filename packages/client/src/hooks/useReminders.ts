/**
 * Reminders: core says which are coming in the next 30 days, this words
 * them and hands them to the shell to show at their times (Android
 * schedules them with the system; the desktop and the web show them while
 * the app runs). Asked again whenever the budget changes, so a bill paid
 * early stops reminding. Off on a device where the user turned them off.
 */

import { useEffect } from 'react';
import type { Reminder } from '@budgetmint/contracts';
import { useCoreQuery } from '../data/BudgetContext';
import { getShell } from '../shell';
import type { ScheduledNotification } from '../shell/types';
import { formatWeekday } from '../utils/dates';
import { formatCents } from '../utils/money';
import { useLocalStorage } from './useLocalStorage';

/** Whether this device shows reminders. */
export const REMINDERS_ON_KEY = 'remindersOn';
export const REMINDER_WINDOW_DAYS = 30;
export const MAX_SCHEDULED = 60;

const when = (lead: number) => (lead === 0 ? 'today' : lead === 1 ? 'tomorrow' : `in ${lead} days`);

/** A reminder in words. */
export function reminderText(reminder: Reminder): { title: string; body: string } {
  const amount = formatCents(reminder.amountCents);
  const day = formatWeekday(reminder.due);
  switch (reminder.kind) {
    case 'bill':
      return {
        title: `${reminder.name} is due ${when(reminder.leadDays)}`,
        body: reminder.autopay ? `${amount} goes out on autopay, ${day}.` : `${amount}, ${day}.`,
      };
    case 'income':
      return { title: `${reminder.name} comes in ${when(reminder.leadDays)}`, body: `${amount}, ${day}.` };
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
  const reminders = useCoreQuery('get_reminders', { windowDays: REMINDER_WINDOW_DAYS, max: MAX_SCHEDULED });
  const list = on ? scheduled(reminders) : [];
  const key = JSON.stringify(list);

  useEffect(() => {
    getShell()
      .platform.notifications.schedule(JSON.parse(key))
      .catch(error => console.warn('Failed to schedule reminders:', error));
  }, [key]);
}
