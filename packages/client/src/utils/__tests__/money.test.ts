import { describe, expect, it } from 'vitest';
import { afterEach } from 'vitest';
import {
  centsToInput,
  currencySymbol,
  formatCents,
  formatMaybeCents,
  formatWholeCents,
  parseDollars,
  setCurrency,
} from '../money';

afterEach(() => setCurrency('USD'));

describe('money', () => {
  it('is written in dollars', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-1200)).toBe('-$12.00');
    expect(formatWholeCents(123456)).toBe('$1,235');
    expect(formatMaybeCents(500, true)).toBe('~$5.00');
    expect(formatMaybeCents(500, false)).toBe('$5.00');
  });

  it('is written in the currency the settings choose, and read with its sign', () => {
    expect(currencySymbol()).toBe('$');
    setCurrency('EUR');
    expect(formatCents(123456)).toBe('€1,234.56');
    expect(formatWholeCents(123456)).toBe('€1,235');
    expect(currencySymbol()).toBe('€');
    expect(parseDollars('€40')).toBe(4_000);
    expect(parseDollars('£ 12.50')).toBe(1_250);
  });

  it('reads what the user typed, or says it isn’t an amount', () => {
    expect(parseDollars('1,200.5')).toBe(120050);
    expect(parseDollars('$40')).toBe(4000);
    expect(parseDollars(' -12.34 ')).toBe(-1234);
    expect(parseDollars('.5')).toBe(50);
    expect(parseDollars('')).toBeNull();
    expect(parseDollars('12.345')).toBeNull();
    expect(parseDollars('abc')).toBeNull();
    // A comma before the cents is a decimal comma, as amounts are shown in much of the world
    expect(parseDollars('1234,50')).toBe(123450);
    expect(parseDollars('12,5')).toBe(1250);
    expect(parseDollars('1.234,50')).toBe(123450);
    expect(parseDollars('1 234,50 $')).toBe(123450);
    expect(parseDollars('-,5')).toBe(-50);
    // Before three digits it groups thousands, like a second point
    expect(parseDollars('1,200')).toBe(120000);
    expect(parseDollars('1,234,567.8')).toBe(123456780);
    expect(parseDollars('1.234.567')).toBe(123456700);
    // Neither one nor the other: not an amount, rather than a guess
    expect(parseDollars('1,2345')).toBeNull();
    expect(parseDollars('1,23,4')).toBeNull();
    expect(parseDollars('1.2,3.4')).toBeNull();
    // A mark with nothing after it yet reads as none
    expect(parseDollars('12,')).toBe(1200);
    expect(parseDollars('12.')).toBe(1200);
    expect(parseDollars('.')).toBeNull();
    expect(centsToInput(120050)).toBe('1200.50');
    expect(centsToInput(null)).toBe('');
  });
});
