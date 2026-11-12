import { describe, expect, it } from 'vitest';
import type { OccurrenceView } from '@budgetmint/contracts';
import { describeRepeat, occurrenceLabel, ordinal } from '../describe';

function occurrence(changes: Partial<OccurrenceView>): OccurrenceView {
  return {
    itemId: 'rent',
    name: 'Rent',
    kind: 'bill',
    category: null,
    autopay: false,
    scheduled: '2026-11-01',
    due: '2026-11-01',
    expectedCents: 100,
    estimated: false,
    varies: false,
    status: { state: 'open' },
    late: false,
    inBalance: false,
    amountCents: null,
    changed: false,
    note: null,
    ...changes,
  };
}

describe('schedules in words', () => {
  it('count in English ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '31st',
    ]);
  });

  it('say how often', () => {
    const from = '2026-11-06';
    expect(describeRepeat({ every: 'once' }, from)).toBe('Once, on Nov 6');
    expect(describeRepeat({ every: 'days', n: 1 }, from)).toBe('Daily');
    expect(describeRepeat({ every: 'days', n: 10 }, from)).toBe('Every 10 days');
    expect(describeRepeat({ every: 'weeks', n: 1 }, from)).toBe('Weekly on Friday');
    expect(describeRepeat({ every: 'weeks', n: 2 }, from)).toBe('Every 2 weeks on Friday');
    expect(describeRepeat({ every: 'months', n: 1, day: 1 }, from)).toBe('Monthly on the 1st');
    expect(describeRepeat({ every: 'months', n: 3, day: 31 }, from)).toBe('Every 3 months on the last day');
    expect(describeRepeat({ every: 'years', n: 1 }, from)).toBe('Yearly on Nov 6');
    expect(describeRepeat({ every: 'years', n: 2 }, from)).toBe('Every 2 years on Nov 6');
  });

  it('label what became of an occurrence', () => {
    expect(occurrenceLabel(occurrence({}))).toBeNull();
    expect(occurrenceLabel(occurrence({ status: { state: 'done', on: '2026-11-01', amountCents: 1 } }))).toBe('Paid');
    expect(
      occurrenceLabel(occurrence({ kind: 'income', status: { state: 'done', on: '2026-11-01', amountCents: 1 } }))
    ).toBe('Received');
    expect(occurrenceLabel(occurrence({ status: { state: 'skipped' } }))).toBe('Skipped');
    expect(occurrenceLabel(occurrence({ late: true }))).toBe('Overdue');
    expect(occurrenceLabel(occurrence({ late: true, kind: 'income' }))).toBe('Late');
    expect(occurrenceLabel(occurrence({ autopay: true }))).toBe('Autopay');
  });
});
