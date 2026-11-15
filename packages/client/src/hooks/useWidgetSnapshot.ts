/**
 * The home screen's widgets, where the shell has them (Android): what they
 * show, sent whenever it changes. A widget is drawn with the app closed, so
 * it's handed a week of days ahead (core's get_glance: each day as core
 * would say it that day), every figure already in words: the money math is
 * core's, the words here, and the widget only picks today's day and shows
 * it. Past the last day it asks to be opened.
 */

import { useEffect } from 'react';
import type { GlanceDay, GoalView, OccurrenceView } from '@budgetmint/contracts';
import { useCoreQuery } from '../data/BudgetContext';
import { getShell } from '../shell';
import { formatDay, formatRelativeDay, formatWeekday } from '../utils/dates';
import { formatCents, formatMaybeCents } from '../utils/money';
import { useTaskMint } from './useTaskMint';

/** The days a snapshot covers, today included: how long the widgets stay right with the app closed. */
export const WIDGET_DAYS = 7;
/** The most lines the Coming up widget is given for a day. */
export const WIDGET_ITEMS = 12;
/** The snapshot's shape, which the widgets (widgets/Snapshot.kt) read. */
export const WIDGET_SNAPSHOT_VERSION = 1;

export interface WidgetItem {
  name: string;
  amount: string;
  /** "Today", "Tomorrow", "Mon, Nov 30". */
  when: string;
  tone: 'overdue' | 'bill' | 'income';
}

export interface WidgetGoal {
  id: string;
  name: string;
  saved: string;
  target: string;
  /** How much of it is set aside, 0 to 100. */
  percent: number;
  /** The next part and its day, or that it's all set aside. */
  next: string;
}

/** One day's widgets, in words. */
export interface WidgetDay {
  /** YYYY-MM-DD: the day these are for. */
  date: string;
  safeToSpend: string;
  balance: string;
  /** The first day the balance goes below zero, or low. */
  alert: { level: 'short' | 'low'; text: string } | null;
  dueThisWeek: string;
  dueThisWeekNote: string;
  comingIn: string;
  /** TaskMint's next withdrawal; null where TaskMint isn't used. */
  withdrawal: { amount: string; note: string } | null;
  items: WidgetItem[];
  goals: WidgetGoal[];
}

export interface WidgetSnapshot {
  version: number;
  days: WidgetDay[];
}

const item = (occurrence: OccurrenceView, today: string, overdue: boolean): WidgetItem => ({
  name: occurrence.name,
  amount: formatMaybeCents(occurrence.amountCents ?? occurrence.expectedCents, occurrence.estimated),
  when: formatRelativeDay(occurrence.due, today),
  tone: overdue ? 'overdue' : occurrence.kind === 'income' ? 'income' : 'bill',
});

const goal = (view: GoalView): WidgetGoal => ({
  id: view.itemId,
  name: view.name,
  saved: formatCents(view.setAsideCents),
  target: formatCents(view.targetCents),
  percent: view.targetCents > 0 ? Math.min(100, Math.round((view.setAsideCents / view.targetCents) * 100)) : 100,
  next: view.nextPart ? `${formatCents(view.nextPart.cents)} on ${formatDay(view.nextPart.date)}` : 'All set aside',
});

/** A day of core's glance, as the widgets show it. */
export function widgetDay({ overview, goals }: GlanceDay, taskmintShown: boolean): WidgetDay {
  const { today, firstShort, firstLow, nextWithdrawal, dueThisWeek } = overview;
  const open = overview.upcoming.flatMap(day => day.occurrences).filter(each => each.status.state === 'open');
  return {
    date: today,
    safeToSpend: formatCents(overview.safeToSpend.cents),
    balance: formatCents(overview.todayCents),
    alert: firstShort
      ? { level: 'short', text: `Below zero ${formatRelativeDay(firstShort.date, today)}` }
      : firstLow
        ? { level: 'low', text: `Low ${formatRelativeDay(firstLow.date, today)}` }
        : null,
    dueThisWeek: formatCents(dueThisWeek.cents),
    dueThisWeekNote: dueThisWeek.count === 1 ? '1 bill' : `${dueThisWeek.count} bills`,
    comingIn: formatCents(overview.incomeAheadCents),
    withdrawal: !taskmintShown
      ? null
      : nextWithdrawal
        ? {
            amount: formatMaybeCents(
              nextWithdrawal.totalCents,
              nextWithdrawal.money.estimatedCents + nextWithdrawal.money.assumedCents > 0
            ),
            note: nextWithdrawal.opensNow
              ? `Open now, in the bank ${formatDay(nextWithdrawal.arrivesOn)}`
              : `In the bank ${formatWeekday(nextWithdrawal.arrivesOn)}`,
          }
        : { amount: '—', note: 'None ahead' },
    items: [
      ...overview.overdue.map(each => item(each, today, true)),
      ...open.map(each => item(each, today, false)),
    ].slice(0, WIDGET_ITEMS),
    goals: goals.goals.map(goal),
  };
}

/** While mounted (signed in, the budget open), the widgets show the budget; after, nothing of it. */
export function useWidgetSnapshot(): void {
  const days = useCoreQuery('get_glance', { days: WIDGET_DAYS });
  const { shown } = useTaskMint();
  const snapshot: WidgetSnapshot = {
    version: WIDGET_SNAPSHOT_VERSION,
    days: days.map(day => widgetDay(day, shown)),
  };
  const json = JSON.stringify(snapshot);
  useEffect(() => {
    getShell().platform.widgets?.set(json);
  }, [json]);
  // Signed out (or the data unreachable): the widgets stop showing the account's money
  useEffect(() => () => getShell().platform.widgets?.set(''), []);
}

/** The widgets' feed, mounted only where the shell has widgets: nothing else asks core for the week. */
export function WidgetFeed(): null {
  useWidgetSnapshot();
  return null;
}
