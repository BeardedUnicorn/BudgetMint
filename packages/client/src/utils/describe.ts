/**
 * Schedules and occurrences in words.
 */

import type { OccurrenceView, Repeat, Weekends } from '@budgetmint/contracts';
import { KIND_WORDS } from './kinds';
import { formatDay, formatDayInYear, parseDay } from './dates';
import { formattingLocale } from './locale';

/** "1st", "2nd", "31st". */
export function ordinal(n: number): string {
  // English suffixes: the app is in English
  const rule = new Intl.PluralRules('en-US', { type: 'ordinal' }).select(n);
  const suffix = { one: 'st', two: 'nd', few: 'rd' }[rule as 'one' | 'two' | 'few'] ?? 'th';
  return `${n}${suffix}`;
}

const every = (n: number, one: string, many: string) => (n === 1 ? one : `Every ${n} ${many}`);

/** "the 15th", "the last day". */
const dayOfMonth = (day: number) => (day === 31 ? 'the last day' : `the ${ordinal(day)}`);

/** Which week of the month (core's 1–4, 5 the last), as a schedule says it. */
export const WEEKS_OF_MONTH = ['first', 'second', 'third', 'fourth', 'last'] as const;

/** A weekday's name: 0 Monday … 6 Sunday, as core numbers them. */
export function weekdayName(weekday: number): string {
  // Nov 9, 2026 was a Monday
  const monday = parseDay('2026-11-09');
  const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + weekday);
  return new Intl.DateTimeFormat(formattingLocale(), { weekday: 'long' }).format(date);
}

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
    case 'months':
      return `${every(repeat.n, 'Monthly', 'months')} on ${dayOfMonth(repeat.day)}`;
    case 'twiceMonthly':
      return `Twice a month, on ${dayOfMonth(repeat.first)} and ${dayOfMonth(repeat.second)}`;
    case 'monthWeekday':
      return `${every(repeat.n, 'Monthly', 'months')} on the ${WEEKS_OF_MONTH[repeat.week - 1]} ${weekdayName(repeat.weekday)}`;
    case 'years':
      return `${every(repeat.n, 'Yearly', 'years')} on ${formatDay(from)}`;
  }
}

/** What a schedule does with weekend dates ("On a weekend, the Friday before"); nothing when they stay. */
export function describeWeekends(weekends: Weekends): string {
  switch (weekends) {
    case 'keep':
      return '';
    case 'before':
      return 'On a weekend, the Friday before';
    case 'after':
      return 'On a weekend, the Monday after';
  }
}

/** How a schedule's end reads after its repeat (", until Jun 30, 2027"); nothing when it goes on. */
export const describeEnd = (until: string | null) => (until ? `, until ${formatDayInYear(until)}` : '');

/** What's become of an occurrence, for a chip: null for one still to come. */
export function occurrenceLabel(occurrence: OccurrenceView): string | null {
  const status = occurrence.status;
  const words = KIND_WORDS[occurrence.kind];
  if (status.state === 'done') return words.done;
  if (status.state === 'skipped') return 'Skipped';
  if (occurrence.late) return words.late;
  if (occurrence.autopay) return words.auto;
  return null;
}
