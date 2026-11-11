/**
 * Schedules and occurrences in words.
 */

import type { OccurrenceView, Repeat } from '@budgetmint/contracts';
import { formatDay, parseDay } from './dates';
import { formattingLocale } from './locale';

/** "1st", "2nd", "31st". */
export function ordinal(n: number): string {
  // English suffixes: the app is in English
  const rule = new Intl.PluralRules('en-US', { type: 'ordinal' }).select(n);
  const suffix = { one: 'st', two: 'nd', few: 'rd' }[rule as 'one' | 'two' | 'few'] ?? 'th';
  return `${n}${suffix}`;
}

const every = (n: number, one: string, many: string) => (n === 1 ? one : `Every ${n} ${many}`);

/** How a repeat reads, from its first date `from`: "Monthly on the 1st", "Every 2 weeks on Friday". */
export function describeRepeat(repeat: Repeat, from: string): string {
  switch (repeat.every) {
    case 'once':
      return `Once, on ${formatDay(from)}`;
    case 'days':
      return every(repeat.n, 'Daily', 'days');
    case 'weeks': {
      const weekday = new Intl.DateTimeFormat(formattingLocale(), { weekday: 'long' }).format(parseDay(from));
      return `${every(repeat.n, 'Weekly', 'weeks')} on ${weekday}`;
    }
    case 'months': {
      const day = repeat.day === 31 ? 'the last day' : `the ${ordinal(repeat.day)}`;
      return `${every(repeat.n, 'Monthly', 'months')} on ${day}`;
    }
    case 'years':
      return `${every(repeat.n, 'Yearly', 'years')} on ${formatDay(from)}`;
  }
}

/** What's become of an occurrence, for a chip: null for one still to come. */
export function occurrenceLabel(occurrence: OccurrenceView): string | null {
  const status = occurrence.status;
  if (status.state === 'done') return occurrence.kind === 'bill' ? 'Paid' : 'Received';
  if (status.state === 'skipped') return 'Skipped';
  if (occurrence.late) return occurrence.kind === 'bill' ? 'Overdue' : 'Late';
  if (occurrence.autopay) return 'Autopay';
  return null;
}
