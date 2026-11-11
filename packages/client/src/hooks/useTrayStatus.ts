/**
 * The tray's lines, where the shell has a tray: today's balance, the next
 * bill, and the lowest ahead. Sent whenever they change (the money math is
 * core's, the words here; the shell only shows them).
 */

import { useEffect } from 'react';
import type { Overview } from '@budgetmint/contracts';
import { useCoreQuery } from '../data/BudgetContext';
import { getShell } from '../shell';
import { formatRelativeDay, formatWeekday } from '../utils/dates';
import { formatCents } from '../utils/money';

export function trayLines(overview: Overview): string[] {
  const lines = [`Today: ${formatCents(overview.todayCents)}`];
  const next = overview.upcoming
    .flatMap(day => day.occurrences)
    .find(occurrence => occurrence.kind === 'bill' && occurrence.status.state === 'open');
  if (next)
    lines.push(
      `Next: ${next.name} · ${formatCents(next.expectedCents)} · ${formatRelativeDay(next.due, overview.today)}`
    );
  lines.push(
    `${overview.lowest.cents < 0 ? 'Short' : 'Lowest ahead'}: ${formatCents(overview.lowest.cents)} on ${formatWeekday(overview.lowest.date)}`
  );
  return lines;
}

export function useTrayStatus(): void {
  const overview = useCoreQuery('get_overview');
  const key = JSON.stringify(trayLines(overview));
  useEffect(() => {
    getShell()
      .platform.tray?.setStatus(JSON.parse(key))
      .catch(error => console.warn('Failed to update the tray:', error));
  }, [key]);
}
