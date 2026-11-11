// Adapted from TaskMint packages/client/src/utils/__tests__/locale.test.ts @ 1623bee (money through utils/money).
import { describe, it, expect, afterEach } from 'vitest';
import {
  formatClockTime,
  formatShortDate,
  formatShortDateTime,
  formatMonthYear,
  formatWeekdayDate,
  formatWeekdayDateTime,
  formattingLocale,
  setFormattingLocale,
} from '../locale';
import { formatCents } from '../money';
import { formatFileSize } from '../locale';

const AT = new Date(2026, 9, 14, 14, 43);

describe('formatting locale', () => {
  afterEach(() => setFormattingLocale('en-US'));

  it('is pinned to US English for the tests', () => {
    expect(formattingLocale()).toBe('en-US');
    expect(formatShortDate(AT)).toBe('Oct 14');
    expect(formatClockTime(AT)).toBe('2:43 PM');
    expect(formatShortDateTime(AT)).toBe('Oct 14, 2:43 PM');
    expect(formatWeekdayDate(AT)).toBe('Wed, Oct 14');
    expect(formatWeekdayDateTime(AT)).toBe('Wed, Oct 14, 2:43 PM');
    expect(formatMonthYear(AT)).toBe('October 2026');
    expect(formatCents(123450)).toBe('$1,234.50');
  });

  it("follows another locale, the way the app follows the system's", () => {
    setFormattingLocale('de-DE');
    expect(formatShortDate(AT)).toBe('14. Okt.');
    expect(formatClockTime(AT)).toBe('14:43');
    expect(formatCents(123450)).toBe('1.234,50\u00a0$');
  });

  it('takes ISO strings and timestamps too', () => {
    expect(formatShortDate(AT.toISOString())).toBe('Oct 14');
    expect(formatShortDate(AT.getTime())).toBe('Oct 14');
  });
});

describe('file sizes', () => {
  it('read in bytes, kilobytes or megabytes', () => {
    expect([512, 839_680, 1_468_006].map(formatFileSize)).toEqual(['512 B', '820 KB', '1.4 MB']);
  });
});
