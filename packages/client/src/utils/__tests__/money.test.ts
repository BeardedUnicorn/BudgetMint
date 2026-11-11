import { describe, expect, it } from 'vitest';
import { centsToInput, formatCents, formatMaybeCents, formatWholeCents, parseDollars } from '../money';

describe('money', () => {
  it('is written in dollars', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-1200)).toBe('-$12.00');
    expect(formatWholeCents(123456)).toBe('$1,235');
    expect(formatMaybeCents(500, true)).toBe('~$5.00');
    expect(formatMaybeCents(500, false)).toBe('$5.00');
  });

  it('reads what the user typed, or says it isn’t an amount', () => {
    expect(parseDollars('1,200.5')).toBe(120050);
    expect(parseDollars('$40')).toBe(4000);
    expect(parseDollars(' -12.34 ')).toBe(-1234);
    expect(parseDollars('.5')).toBe(50);
    expect(parseDollars('')).toBeNull();
    expect(parseDollars('12.345')).toBeNull();
    expect(parseDollars('abc')).toBeNull();
    expect(centsToInput(120050)).toBe('1200.50');
    expect(centsToInput(null)).toBe('');
  });
});
