/**
 * Money: cents everywhere, written in dollars in the user's locale.
 */

import { formattingLocale } from './locale';

/** "$1,234.50"; "-$12.00" below zero. */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat(formattingLocale(), { style: 'currency', currency: 'USD' }).format(cents / 100);
}

/** Whole dollars, for tight spaces ("$1,235"). */
export function formatWholeCents(cents: number): string {
  return new Intl.NumberFormat(formattingLocale(), {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}

/** An amount with a ~ when some of it is estimated or assumed. */
export function formatMaybeCents(cents: number, uncertain: boolean): string {
  return `${uncertain ? '~' : ''}${formatCents(cents)}`;
}

/**
 * What the user typed ("1,200.5", "$40", "1234,50"), as cents; null when it
 * isn't an amount. Amounts are shown in the system's locale, so either mark
 * may be the decimal one: with both, the later is; a lone comma is, unless
 * exactly three digits follow it (then it groups thousands, as several
 * points do). Anything that reads neither way is refused rather than guessed.
 */
export function parseDollars(text: string): number | null {
  const typed = text.replace(/[$\s]/g, '');
  const point = typed.lastIndexOf('.');
  const comma = typed.lastIndexOf(',');
  let decimal: '' | '.' | ',' = '';
  if (point >= 0 && comma >= 0) decimal = point > comma ? '.' : ',';
  else if (comma >= 0) decimal = /,\d{3}$/.test(typed) ? '' : ',';
  else if (point >= 0 && typed.indexOf('.') === point) decimal = '.';
  const at = decimal ? typed.lastIndexOf(decimal) : typed.length;
  const whole = typed.slice(0, at);
  const cents = typed.slice(at + 1);
  // Without a decimal mark only one kind of mark is there, and it groups
  const group = { '.': ',', ',': '\\.', '': '[.,]' }[decimal];
  const grouped = new RegExp(`^-?(\\d*|\\d{1,3}(${group}\\d{3})+)$`);
  if (!grouped.test(whole) || !/^\d{0,2}$/.test(cents) || !/\d/.test(typed)) return null;
  const dollars = Number(`${whole.replace(/[^\d]/g, '') || 0}.${cents || 0}`);
  return Math.round(dollars * 100) * (whole.startsWith('-') ? -1 : 1);
}

/** Cents as the amount field shows them ("1200.50"; "" for none). */
export function centsToInput(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2);
}
