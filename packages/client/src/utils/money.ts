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

/** What the user typed ("1,200.5", "$40"), as cents; null when it isn't an amount. */
export function parseDollars(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned) && !/^-?\.\d{1,2}$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Cents as the amount field shows them ("1200.50"; "" for none). */
export function centsToInput(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2);
}
