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
  earnedCents: 0,
  earnedUncertainCents: 0,
  earnedArrivesOn: null,
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

  const DAY = 86_400_000;
  /**
   * Taken on Nov 7 (in the bank on the 8th, before the cash flow starts) and Oct 20. The 3rd's
   * and 4th's work is released already: the withdrawal open now takes it, in the bank on the
   * 11th. The 5th's is released on the 12th: the next one takes it, on the 13th, in on the 14th.
   */
  const EARNINGS = forecastDoc({
    asOfMs: TEST_NOW,
    zone: 'America/Chicago',
    cutoff: { takenAtMs: TEST_NOW - 3 * DAY, amountCents: 2_500 },
    recentWithdrawals: [
      { takenAtMs: TEST_NOW - 3 * DAY, amountCents: 2_500 },
      { takenAtMs: TEST_NOW - 21 * DAY, amountCents: 1_800 },
    ],
    nextAllowedAtMs: TEST_NOW,
    carried: { actualCents: 1_300, estimatedCents: 200, pastDueCents: 0 },
    carriedDays: [
      { day: '2026-11-03', actualCents: 1_000, estimatedCents: 0, pastDueCents: 0 },
      { day: '2026-11-04', actualCents: 300, estimatedCents: 200, pastDueCents: 0 },
    ],
    steps: [
      {
        atMs: TEST_NOW + 2 * DAY - 3 * 3_600_000,
        day: '2026-11-05',
        actualCents: 700,
        estimatedCents: 0,
        pastDueCents: 0,
      },
    ],
  });

  it('shows what each work day earned in TaskMint until a withdrawal takes it', async () => {
    const { user } = await calendar({ settings: { balance: { cents: 0, asOf: '2026-11-09' } }, forecast: EARNINGS });
    const named = (name: RegExp) => screen.getByRole('button', { name });
    expect(
      named(
        /^Tuesday, November 3, 2026: TaskMint earned, not withdrawn yet \$10\.00, in the bank Wednesday, November 11, 2026$/
      )
    ).toBeInTheDocument();
    expect(
      named(
        /^Wednesday, November 4, 2026: TaskMint earned, not withdrawn yet about \$5\.00, in the bank Wednesday, November 11, 2026$/
      )
    ).toBeInTheDocument();
    expect(
      named(
        /^Thursday, November 5, 2026: TaskMint earned, not withdrawn yet \$7\.00, in the bank Saturday, November 14, 2026$/
      )
    ).toBeInTheDocument();
    // The withdrawals still show on the days they reach the bank, and the balance only moves then
    expect(
      named(/^Wednesday, November 11, 2026: TaskMint withdrawal expected \$15\.00; balance \$15\.00$/)
    ).toBeInTheDocument();
    expect(named(/^Thursday, November 12, 2026: balance \$15\.00$/)).toBeInTheDocument();
    // The one that reached the bank before the balance's day shows too, and counts in the month's total
    expect(named(/^Sunday, November 8, 2026: TaskMint withdrawal \$25\.00$/)).toBeInTheDocument();
    expect(screen.getByText('TaskMint', { selector: 'div' }).nextSibling).toHaveTextContent('$47.00');
    // A bar on a phone, a dotted badge wider, with ~ where some of it is estimated
    expect(document.querySelector('[data-dot="earned"]')).toHaveStyle({ height: '3px' });
    expect(screen.getByText('~$5.00')).toBeInTheDocument();
    expect(screen.getByText('Earned, not withdrawn yet')).toBeInTheDocument();

    await user.click(named(/^Wednesday, November 4, 2026/));
    const dialog = screen.getByRole('dialog', { name: 'Wednesday, November 4, 2026' });
    expect(within(dialog).getByText('Earned in TaskMint, not withdrawn yet')).toBeInTheDocument();
    expect(within(dialog).getByText('~$5.00')).toBeInTheDocument();
    expect(
      within(dialog).getByText('In the bank Wednesday, November 11, 2026, with the withdrawal that takes it.')
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('Nothing due.')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    // Last month's withdrawal, before the balance too
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText('TaskMint', { selector: 'div' }).nextSibling).toHaveTextContent('$18.00');
  });

  it('says when no withdrawal ahead takes a day’s earnings', async () => {
    const { user } = await calendar({
      settings: { balance: { cents: 0, asOf: '2026-11-09' }, taskmint: { minWithdrawalCents: 1_000_000 } },
      forecast: EARNINGS,
    });
    const nov3 = screen.getByRole('button', {
      name: /^Tuesday, November 3, 2026: TaskMint earned, not withdrawn yet \$10\.00, no withdrawal ahead takes it yet$/,
    });
    await user.click(nov3);
    expect(
      within(screen.getByRole('dialog', { name: 'Tuesday, November 3, 2026' })).getByText(
        'No withdrawal ahead takes it yet.'
      )
    ).toBeInTheDocument();
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
