import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { CalendarDay } from '@budgetmint/contracts';
import { forecastDoc, item, monthly, override, startBudget, TEST_NOW } from '../../../../__tests__/setup/budget';
import { describeDay } from '../DayCell';
import { keyTarget, weeksOf } from '../MonthGrid';

const PAY = item({
  id: 'pay',
  kind: 'income',
  name: 'Paycheck',
  schedule: [{ from: '2026-11-13', until: null, repeat: { every: 'once' }, amountCents: 80_000 }],
});

async function calendar(seed: Parameters<typeof startBudget>[0] = {}) {
  const started = await startBudget(seed);
  // The sidebar's (the overview has a Calendar button too)
  await started.user.click(screen.getAllByRole('button', { name: 'Calendar' })[0]);
  return started;
}

const day = (changes: Partial<CalendarDay>): CalendarDay => ({
  date: '2026-11-12',
  occurrences: [],
  billsCents: 0,
  incomeCents: 0,
  withdrawalCents: 0,
  withdrawalUncertainCents: 0,
  withdrawalProjected: false,
  closingCents: null,
  short: false,
  low: false,
  ...changes,
});

describe('the calendar', () => {
  it('shows the month’s days with what’s due and the balance they end on', async () => {
    await calendar({ items: [monthly('rent', 'Rent', 12, 150_000), PAY] });
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    // A phone's dots differ in shape as well as color: bills round, income a diamond
    expect(document.querySelector('[data-dot="error"]')).toHaveStyle({ borderRadius: '50%' });
    expect(document.querySelector('[data-dot="success"]')).toHaveStyle({ transform: 'rotate(45deg)' });
    expect(screen.getByText('Bills', { selector: 'div' }).nextSibling).toHaveTextContent('$1,500.00');
    expect(screen.getByText('Income', { selector: 'div' }).nextSibling).toHaveTextContent('$800.00');
    const rent = screen.getByRole('button', {
      name: /^Thursday, November 12, 2026: bills \$1,500\.00; balance -\$500\.00, below zero/,
    });
    expect(rent).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Friday, November 13, 2026: income \$800\.00; balance \$300\.00$/ })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Sunday, November 1, 2026: nothing due$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled();
  });

  it('moves between months, and back to today', async () => {
    const { user } = await calendar({ items: [monthly('rent', 'Rent', 12, 50_000)] });
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'December 2026' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
  });

  it('opens a day, steps to the next ones (into the next month), and marks a bill there paid', async () => {
    const { user, store } = await calendar({
      items: [monthly('rent', 'Rent', 30, 50_000), monthly('fee', 'Fee', 1, 100)],
    });
    await user.click(screen.getByRole('button', { name: /^Monday, November 30, 2026/ }));
    let dialog = screen.getByRole('dialog', { name: 'Monday, November 30, 2026' });
    expect(within(dialog).getByText('Balance at the end of the day: $500.00')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Mark Rent paid' }));
    await waitFor(() => expect(store.docs.has('occ~2026-11-30~rent')).toBe(true));
    await user.click(within(dialog).getByRole('button', { name: 'The day after' }));
    dialog = screen.getByRole('dialog', { name: 'Tuesday, December 1, 2026' });
    // Behind the dialog, the month followed
    expect(screen.getByRole('heading', { name: 'December 2026', hidden: true })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'The day before' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Monday, November 30, 2026' })).getByRole('button', {
        name: 'The day before',
      })
    );
    expect(
      within(screen.getByRole('dialog', { name: 'Sunday, November 29, 2026' })).getByText('Nothing due.')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('moves the focus with the keys, into other months when it runs off this one', async () => {
    await calendar();
    const today = screen.getByRole('button', { name: /^Tuesday, November 10, 2026/ });
    expect(today).toHaveAttribute('tabindex', '0');
    today.focus();
    fireEvent.keyDown(today, { key: 'ArrowRight' });
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-date', '2026-11-11'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    fireEvent.keyDown(document.activeElement!, { key: 'PageDown' });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'December 2026' })).toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-date', '2026-12-11'));
    // Home on a Sunday stays put
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-date', '2026-12-06'));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toHaveAttribute('data-date', '2026-12-06');
  });

  it('shows TaskMint’s withdrawals, recorded and expected', async () => {
    await calendar({
      settings: { balance: { cents: 0, asOf: '2026-11-09' } },
      forecast: forecastDoc({
        asOfMs: TEST_NOW,
        recentWithdrawals: [{ takenAtMs: TEST_NOW - 86_400_000, amountCents: 2_500 }],
        cutoff: { takenAtMs: TEST_NOW - 86_400_000, amountCents: 2_500 },
        steps: [{ atMs: TEST_NOW + 86_400_000, actualCents: 0, estimatedCents: 900, pastDueCents: 0 }],
      }),
    });
    expect(
      screen.getByRole('button', { name: /^Tuesday, November 10, 2026: TaskMint withdrawal \$25\.00/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Friday, November 13, 2026: TaskMint withdrawal expected \$9\.00/ })
    ).toBeInTheDocument();
    expect(screen.getByText('TaskMint', { selector: 'div' }).nextSibling).toHaveTextContent('$34.00');
  });

  it('works out the keys’ moves and the weeks', () => {
    expect(keyTarget('ArrowUp', '2026-11-10')).toBe('2026-11-03');
    expect(keyTarget('ArrowDown', '2026-11-10')).toBe('2026-11-17');
    expect(keyTarget('End', '2026-11-10')).toBe('2026-11-14');
    expect(keyTarget('PageUp', '2026-03-31')).toBe('2026-02-28');
    expect(keyTarget('Tab', '2026-11-10')).toBeNull();
    const weeks = weeksOf(
      Array.from({ length: 30 }, (_, i) => day({ date: `2026-11-${String(i + 1).padStart(2, '0')}` }))
    );
    expect(weeks).toHaveLength(5);
    expect(weeks[4].filter(Boolean)).toHaveLength(2);
  });

  it('puts a day in words, its skipped and paid ones counted rightly', () => {
    const bill = {
      itemId: 'rent',
      name: 'Rent',
      kind: 'bill' as const,
      category: null,
      autopay: false,
      scheduled: '2026-11-12',
      due: '2026-11-12',
      expectedCents: 1_000,
      status: { state: 'open' as const },
      late: false,
      amountCents: null,
      changed: false,
      note: null,
    };
    const busy = day({
      occurrences: [
        bill,
        { ...bill, status: { state: 'done', on: '2026-11-12', amountCents: 900 } },
        { ...bill, status: { state: 'skipped' } },
      ],
      billsCents: 1_900,
      closingCents: 50,
      low: true,
    });
    expect(describeDay(busy)).toBe('Thursday, November 12, 2026: bills $19.00; balance $0.50, low');
    expect(override).toBeDefined();
  });
});
