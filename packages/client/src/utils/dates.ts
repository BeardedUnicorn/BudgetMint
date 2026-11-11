/**
 * Budget dates are calendar days ("2026-11-30") where the user is; core
 * hands them out as text. These read and write them in the user's locale.
 */

import { formattingLocale } from './locale';

/** The local midnight of a YYYY-MM-DD date. */
export function parseDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `date`'s local day as YYYY-MM-DD. */
export function toDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day `days` after `day`. */
export function addDays(day: string, days: number): string {
  const date = parseDay(day);
  date.setDate(date.getDate() + days);
  return toDay(date);
}

/** Days from `from` to `to` (negative when `to` is before). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

const format = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(formattingLocale(), options).format(parseDay(day));

/** "Nov 30" */
export const formatDay = (day: string) => format(day, { month: 'short', day: 'numeric' });

/** "Nov 30, 2026": for a date that may be in another year. */
export const formatDayInYear = (day: string) => format(day, { month: 'short', day: 'numeric', year: 'numeric' });

/** "Mon, Nov 30" */
export const formatWeekday = (day: string) => format(day, { weekday: 'short', month: 'short', day: 'numeric' });

/** "Monday, November 30, 2026" */
export const formatLongDay = (day: string) =>
  format(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

/** "Today", "Tomorrow", "Yesterday", or "Mon, Nov 30". */
export function formatRelativeDay(day: string, today: string): string {
  const ahead = daysBetween(today, day);
  if (ahead === 0) return 'Today';
  if (ahead === 1) return 'Tomorrow';
  if (ahead === -1) return 'Yesterday';
  return formatWeekday(day);
}

/** "November 2026" for a YYYY-MM month. */
export const formatMonth = (month: string) => format(`${month}-01`, { month: 'long', year: 'numeric' });

/** The month after (or before, with -1) a YYYY-MM month. */
export function addMonths(month: string, months: number): string {
  const date = parseDay(`${month}-01`);
  date.setMonth(date.getMonth() + months);
  return toDay(date).slice(0, 7);
}

/** "Mon, Nov 30, 9:00 AM" for an instant. */
export function formatMoment(ms: number): string {
  return new Intl.DateTimeFormat(formattingLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms));
}
