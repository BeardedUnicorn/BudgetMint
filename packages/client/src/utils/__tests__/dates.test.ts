import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  formatDay,
  formatLongDay,
  formatMoment,
  formatMonth,
  formatRelativeDay,
  formatWeekday,
  parseDay,
  toDay,
} from '../dates';

describe('budget dates', () => {
  it('are local calendar days', () => {
    expect(parseDay('2026-11-30')).toEqual(new Date(2026, 10, 30));
    expect(toDay(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-11-10', '2026-11-14')).toBe(4);
    expect(daysBetween('2026-11-14', '2026-11-10')).toBe(-4);
    // Across daylight saving's change, still whole days
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });

  it('are written in the user’s locale', () => {
    expect(formatDay('2026-11-30')).toBe('Nov 30');
    expect(formatWeekday('2026-11-30')).toBe('Mon, Nov 30');
    expect(formatLongDay('2026-11-30')).toBe('Monday, November 30, 2026');
    expect(formatMonth('2026-11')).toBe('November 2026');
    expect(formatMoment(new Date(2026, 10, 30, 9, 5).getTime())).toBe('Mon, Nov 30, 9:05 AM');
  });

  it('say today, tomorrow and yesterday as such', () => {
    expect(formatRelativeDay('2026-11-10', '2026-11-10')).toBe('Today');
    expect(formatRelativeDay('2026-11-11', '2026-11-10')).toBe('Tomorrow');
    expect(formatRelativeDay('2026-11-09', '2026-11-10')).toBe('Yesterday');
    expect(formatRelativeDay('2026-11-14', '2026-11-10')).toBe('Sat, Nov 14');
  });
});
