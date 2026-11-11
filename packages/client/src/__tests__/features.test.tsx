/**
 * The features of 1.4: paydays twice a month or on a weekday, weekends
 * moved, varying amounts, money set aside (the savings page), safe to
 * spend, everyday spending, the balance checked as it's updated, what
 * TaskMint would need to earn to cover a short day, monthly reports and a
 * bank statement read into the bills.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { forecastDoc, item, monthly, override, startBudget, TEST_NOW } from './setup/budget';
import { tooltipMoney } from '../components/pages/forecast/ForecastPage';
import { describeRepeat, describeWeekends, weekdayName } from '../utils/describe';

const DAY_MS = 86_400_000;

type Docs = { docs: Map<string, { json: string }> };
const docOf = (store: Docs, id: string) => JSON.parse(store.docs.get(id)!.json);
const itemNamed = (store: Docs, name: string) =>
  [...store.docs.values()].map(doc => JSON.parse(doc.json)).find(doc => doc.name === name);

type User = Awaited<ReturnType<typeof startBudget>>['user'];

async function pick(user: User, within_: HTMLElement, label: string, option: string) {
  await user.click(within(within_).getByLabelText(label));
  await user.click(screen.getByRole('option', { name: option }));
}

const section = (name: string) => screen.getByRole('heading', { name }).closest('.MuiPaper-root') as HTMLElement;

describe('paydays and bills on schedules banks keep', () => {
  it('adds pay twice a month, the Friday before a weekend', async () => {
    const { user, store } = await startBudget();
    await user.click(screen.getByRole('button', { name: 'Income' }));
    await user.click(screen.getAllByRole('button', { name: 'Add income' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Add income' });
    await user.type(within(dialog).getByLabelText('Name'), 'Paycheck');
    await user.type(within(dialog).getByLabelText('Amount'), '1500');
    await pick(user, dialog, 'Repeats', 'Twice a month');
    expect(within(dialog).queryByLabelText(/Every how many/)).not.toBeInTheDocument();
    await pick(user, dialog, 'First on day', 'The 15th');
    // Days up to the first can't be the second
    await user.click(within(dialog).getByLabelText('Then on day'));
    expect(screen.getByRole('option', { name: 'The 15th' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('option', { name: 'The last day' }));
    await pick(user, dialog, 'On a weekend', 'Move to the Friday before');
    expect(within(dialog).getByText('When it comes on a Saturday or Sunday')).toBeInTheDocument();
    // Income isn't saved up for
    expect(within(dialog).queryByRole('switch', { name: /Set money aside/ })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(itemNamed(store, 'Paycheck').schedule[0]).toMatchObject({
      repeat: { every: 'twiceMonthly', first: 15, second: 31 },
      weekends: 'before',
    });
    expect(screen.getByText('Twice a month, on the 15th and the last day')).toBeInTheDocument();
    expect(screen.getByText('On a weekend, the Friday before')).toBeInTheDocument();
    // Twice a month comes to twice the amount a month
    expect(screen.getByText(/About \$3,000\.00 a month/)).toBeInTheDocument();
  });

  it('adds a bill on the second Friday whose amount varies, and one saved up for', async () => {
    const { user, store } = await startBudget();
    await user.click(screen.getByRole('button', { name: 'Bills' }));
    await user.click(screen.getAllByRole('button', { name: 'Add bill' })[0]);
    let dialog = screen.getByRole('dialog', { name: 'Add bill' });
    await user.type(within(dialog).getByLabelText('Name'), 'Power');
    await user.type(within(dialog).getByLabelText('Amount'), '80');
    await pick(user, dialog, 'Repeats', 'Monthly on a weekday');
    // Today's weekday to start with: Nov 10 is a Tuesday
    expect(within(dialog).getByLabelText('Day of the week')).toHaveTextContent('Tuesday');
    await pick(user, dialog, 'On the', 'Third');
    await pick(user, dialog, 'Day of the week', 'Friday');
    expect(within(dialog).getByText('When it’s due on a Saturday or Sunday')).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('switch', { name: /The amount varies: expect the average of the last 3 paid/ })
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(itemNamed(store, 'Power')).toMatchObject({
      varies: true,
      saveUp: null,
      schedule: [{ repeat: { every: 'monthWeekday', n: 1, week: 3, weekday: 4 } }],
    });
    expect(screen.getByText('Monthly on the third Friday')).toBeInTheDocument();
    // Nothing paid yet to average
    expect(screen.getByText('varies')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Add bill' })[0]);
    dialog = screen.getByRole('dialog', { name: 'Add bill' });
    await user.type(within(dialog).getByLabelText('Name'), 'Car insurance');
    await user.type(within(dialog).getByLabelText('Amount'), '1200');
    await pick(user, dialog, 'Repeats', 'Every… years');
    await user.click(within(dialog).getByRole('switch', { name: /Set money aside for it each month/ }));
    // Every few days, there's no time to save: the switch goes
    await pick(user, dialog, 'Repeats', 'Every… days');
    expect(within(dialog).queryByRole('switch', { name: /Set money aside/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('On a weekend')).not.toBeInTheDocument();
    await pick(user, dialog, 'Repeats', 'Every… years');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(itemNamed(store, 'Car insurance').saveUp).toEqual({ since: '2026-11-10' });
    expect(screen.getByText('Saving up')).toBeInTheDocument();
  });

  it('edits the new schedules where they are, and a change to weekends counts as one', async () => {
    const twice = item({
      id: 'pay',
      kind: 'income',
      name: 'Paycheck',
      schedule: [
        {
          from: '2026-10-01',
          until: null,
          repeat: { every: 'twiceMonthly', first: 1, second: 15 },
          amountCents: 150_000,
          weekends: 'after',
        },
      ],
    });
    const weekday = monthly('club', 'Club', 1, 2_000, {
      schedule: [
        {
          from: '2026-10-01',
          until: null,
          repeat: { every: 'monthWeekday', n: 2, week: 5, weekday: 0 },
          amountCents: 2_000,
          weekends: 'keep',
        },
      ],
    });
    const { user, store } = await startBudget({ items: [twice, weekday] });
    await user.click(screen.getByRole('button', { name: 'Income' }));
    expect(screen.getByText('Twice a month, on the 1st and the 15th')).toBeInTheDocument();
    expect(screen.getByText('On a weekend, the Monday after')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit Paycheck' }));
    let dialog = screen.getByRole('dialog', { name: 'Edit Paycheck' });
    expect(within(dialog).getByLabelText('First on day')).toHaveTextContent('The 1st');
    expect(within(dialog).getByLabelText('Then on day')).toHaveTextContent('The 15th');
    await pick(user, dialog, 'On a weekend', 'Keep the date');
    // It started already: from when?
    expect(within(dialog).getByLabelText('The change starts on')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const schedule = docOf(store, 'item~pay').schedule;
    expect(schedule.at(-1)).toMatchObject({ from: '2026-11-10', weekends: 'keep' });

    await user.click(screen.getByRole('button', { name: 'Bills' }));
    expect(screen.getByText('Every 2 months on the last Monday')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit Club' }));
    dialog = screen.getByRole('dialog', { name: 'Edit Club' });
    expect(within(dialog).getByLabelText('On the')).toHaveTextContent('Last');
    expect(within(dialog).getByLabelText('Day of the week')).toHaveTextContent('Monday');
    expect(within(dialog).getByLabelText('Every how many months')).toHaveValue(2);
    // Twice a month from a 31st: the first day can't be the last
    await pick(user, dialog, 'Repeats', 'Twice a month');
    expect(within(dialog).getByLabelText('First on day')).toHaveTextContent('The 10th');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  });

  it('expects a varying bill at what it was paid, and says so', async () => {
    const power = monthly('power', 'Power', 12, 8_000, { varies: true });
    const { user, store } = await startBudget({
      items: [power],
      overrides: [
        override({
          itemId: 'power',
          date: '2026-10-12',
          status: { state: 'done', on: '2026-10-12', amountCents: 9_500 },
        }),
      ],
    });
    // The overview's next 14 days: ~$95.00
    expect(screen.getByText('−~$95.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Power on Nov 12: details' }));
    expect(screen.getByText(/the average of the last few/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Bills' }));
    expect(screen.getByText('as last time')).toBeInTheDocument();
    store.putDoc(
      'occ~2026-09-12~power',
      JSON.stringify(
        override({
          itemId: 'power',
          date: '2026-09-12',
          status: { state: 'done', on: '2026-09-12', amountCents: 8_500 },
        })
      )
    );
    expect(await screen.findByText('average of last 2')).toBeInTheDocument();
    expect(screen.getByText('~$90.00')).toBeInTheDocument();
  });

  it('says each schedule in words', () => {
    expect(describeRepeat({ every: 'twiceMonthly', first: 1, second: 31 }, '2026-11-01')).toBe(
      'Twice a month, on the 1st and the last day'
    );
    expect(describeRepeat({ every: 'monthWeekday', n: 1, week: 1, weekday: 6 }, '2026-11-01')).toBe(
      'Monthly on the first Sunday'
    );
    expect(describeWeekends('keep')).toBe('');
    expect(describeWeekends('before')).toBe('On a weekend, the Friday before');
    expect(describeWeekends('after')).toBe('On a weekend, the Monday after');
    expect(weekdayName(0)).toBe('Monday');
  });
});

describe('savings', () => {
  it('adds a goal and shows each bill saved up for', async () => {
    const insurance = item({
      id: 'car',
      kind: 'bill',
      name: 'Car insurance',
      saveUp: { since: '2026-01-01' },
      schedule: [
        { from: '2026-03-03', until: null, repeat: { every: 'years', n: 1 }, amountCents: 120_000, weekends: 'keep' },
      ],
    });
    const { user, store } = await startBudget({ items: [insurance] });
    await user.click(screen.getByRole('button', { name: 'Savings' }));
    expect(screen.getByText('$900.00 set aside today, not counted as safe to spend.')).toBeInTheDocument();
    const car = screen.getByRole('region', { name: 'Car insurance' });
    expect(within(car).getByText('Next due Mar 3, 2027')).toBeInTheDocument();
    expect(within(car).getByText('$900.00 of $1,200.00')).toBeInTheDocument();
    expect(within(car).getByText('Next $100.00 on Dec 4, 2026, then 2 more.')).toBeInTheDocument();
    expect(within(car).getByRole('progressbar', { name: 'Car insurance: 75% set aside' })).toBeInTheDocument();

    await user.click(within(car).getByRole('button', { name: 'Edit Car insurance' }));
    expect(screen.getByRole('switch', { name: /Set money aside for it each month/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Add a goal' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a savings goal' });
    await user.type(within(dialog).getByLabelText('Name'), 'Holiday');
    await user.type(within(dialog).getByLabelText('Amount'), '1000');
    fireEvent.change(within(dialog).getByLabelText('On'), { target: { value: '2027-02-20' } });
    expect(within(dialog).getByRole('switch', { name: /Save up for it/ })).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(itemNamed(store, 'Holiday')).toMatchObject({
      saveUp: { since: '2026-11-10' },
      schedule: [{ repeat: { every: 'once' } }],
    });
    const holiday = await screen.findByRole('region', { name: 'Holiday' });
    expect(within(holiday).getByText('On Feb 20, 2027')).toBeInTheDocument();
    expect(within(holiday).getByText('$250.00 of $1,000.00')).toBeInTheDocument();

    // Its last part: the last
    store.putDoc(
      'item~holiday-soon',
      JSON.stringify(
        item({
          id: 'holiday-soon',
          kind: 'bill',
          name: 'Gift',
          saveUp: { since: '2026-10-20' },
          schedule: [{ from: '2026-12-01', until: null, repeat: { every: 'once' }, amountCents: 0, weekends: 'keep' }],
        })
      )
    );
    const gift = await screen.findByRole('region', { name: 'Gift' });
    expect(within(gift).getByText('Next $0.00 on Nov 20, 2026, the last.')).toBeInTheDocument();
    expect(within(gift).getByRole('progressbar', { name: 'Gift: 100% set aside' })).toBeInTheDocument();
  });

  it('says how to start when nothing is saved up for, and that all of one is set aside', async () => {
    const { user, store } = await startBudget();
    await user.click(screen.getByRole('button', { name: 'Savings' }));
    expect(screen.getByText('Nothing saved up for yet')).toBeInTheDocument();
    expect(screen.getByText('Put money by a month at a time for yearly bills and things to come.')).toBeInTheDocument();
    store.putDoc(
      'item~done',
      JSON.stringify(
        item({
          id: 'done',
          kind: 'bill',
          name: 'Laptop',
          saveUp: { since: '2026-09-15' },
          schedule: [
            { from: '2026-11-14', until: null, repeat: { every: 'once' }, amountCents: 60_000, weekends: 'keep' },
          ],
        })
      )
    );
    const laptop = await screen.findByRole('region', { name: 'Laptop' });
    expect(within(laptop).getByText('All of it is set aside.')).toBeInTheDocument();
    // The Savings page's edit of a bill deleted meanwhile closes
    await user.click(within(laptop).getByRole('button', { name: 'Edit Laptop' }));
    store.putDoc('item~done', null);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('safe to spend, everyday spending and TaskMint’s cover', () => {
  it('says what’s safe to spend after the everyday spending and what’s set aside', async () => {
    const insurance = item({
      id: 'car',
      kind: 'bill',
      name: 'Car insurance',
      saveUp: { since: '2026-11-10' },
      schedule: [{ from: '2027-03-03', until: null, repeat: { every: 'once' }, amountCents: 40_000, weekends: 'keep' }],
    });
    const { user, store } = await startBudget({
      items: [insurance, monthly('rent', 'Rent', 20, 10_000)],
      settings: { balance: { cents: 300_000, asOf: '2026-11-10' }, spendingWeeklyCents: 7_000 },
    });
    const safe = screen.getByRole('group', { name: 'Safe to spend' });
    expect(
      within(safe).getByText(
        'It stays above $0.00 through Jan 9, after $70.00 a week of everyday spending and $100.00 set aside for bills'
      )
    ).toBeInTheDocument();

    // The forecast takes a day's share each day, and draws the balance besides what's set aside
    await user.click(screen.getByRole('button', { name: 'Forecast' }));
    expect(screen.getByText('Everyday spending: $70.00 a week, a day’s share each day.')).toBeInTheDocument();
    expect(screen.getByText('The dashed line leaves out the money set aside for bills.')).toBeInTheDocument();
    expect(screen.getAllByText('Everyday spending').length).toBeGreaterThan(0);
    expect(tooltipMoney(10, 'free')).toEqual(['$10.00', 'Besides what’s set aside']);

    // And the calendar's day says what it took out (a tenth of $70, Wednesday's share)
    await user.click(screen.getByRole('button', { name: 'Calendar' }));
    await user.click(screen.getByRole('button', { name: /^Wednesday, November 11/ }));
    const day = screen.getByRole('dialog', { name: 'Wednesday, November 11, 2026' });
    expect(within(day).getByText('Everyday spending (assumed)')).toBeInTheDocument();
    expect(within(day).getByText('−$10.00')).toBeInTheDocument();
    await user.click(within(day).getByRole('button', { name: 'Close' }));

    // Nothing to spare
    store.putDoc('settings~account', JSON.stringify({ balance: { cents: 5_000, asOf: '2026-11-10' } }));
    await user.click(screen.getByRole('button', { name: 'Overview' }));
    expect(
      await screen.findByText(
        /^Nothing to spare: after \$100\.00 set aside for bills, it gets to -\$[\d,.]+ on \w+, \w+ \d+$/
      )
    ).toBeInTheDocument();
    // Nothing set aside or spent besides, and a mark above zero
    store.putDoc('item~car', null);
    store.putDoc(
      'settings~account',
      JSON.stringify({ balance: { cents: 5_000, asOf: '2026-11-10' }, lowBalanceCents: 100_000 })
    );
    expect(
      await screen.findByText(/^Nothing to spare: it gets to -\$[\d,.]+ on \w+, \w+ \d+, under your \$1,000\.00 mark$/)
    ).toBeInTheDocument();
  });

  it('sets the everyday spending, and offers what the balance updates say it is', async () => {
    const { user, store } = await startBudget({
      settings: {
        balance: { cents: 80_000, asOf: '2026-11-10' },
        checks: [
          {
            from: '2026-11-01',
            to: '2026-11-10',
            expectedCents: 81_800,
            actualCents: 80_000,
            assumedSpendingCents: 9_000,
          },
        ],
      },
    });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const forecast = section('Forecast');
    expect(
      within(forecast).getByText(
        'By your balance updates over the last 9 days, you spend about $84.00 a week besides your bills.'
      )
    ).toBeInTheDocument();
    await user.click(within(forecast).getByRole('button', { name: 'Use it' }));
    await waitFor(() => expect(docOf(store, 'settings~account').spendingWeeklyCents).toBe(8_400));
    expect(within(forecast).queryByRole('button', { name: 'Use it' })).not.toBeInTheDocument();
    const field = within(forecast).getByLabelText('Everyday spending, a week');
    await user.clear(field);
    await user.type(field, '50');
    fireEvent.blur(field);
    await waitFor(() => expect(docOf(store, 'settings~account').spendingWeeklyCents).toBe(5_000));
  });

  const taskmint = (more: Record<string, unknown> = {}) =>
    forecastDoc({
      asOfMs: TEST_NOW,
      lastImportMs: TEST_NOW,
      cutoff: { takenAtMs: TEST_NOW - DAY_MS, amountCents: 0 },
      nextAllowedAtMs: TEST_NOW + 2 * DAY_MS,
      zone: 'America/Chicago',
      ...more,
    });
  const rentOn = (from: string) =>
    item({
      id: 'rent',
      kind: 'bill',
      name: 'Rent',
      schedule: [{ from, until: null, repeat: { every: 'once' }, amountCents: 30_000, weekends: 'keep' }],
    });

  it('says what more TaskMint would have to earn, and by when', async () => {
    await startBudget({
      items: [rentOn('2026-11-30')],
      settings: { balance: { cents: 10_000, asOf: '2026-11-09' } },
      forecast: taskmint(),
    });
    expect(
      screen.getByText(
        'TaskMint could cover it: earn $200.00 more by the end of Sun, Nov 22, withdraw it Sun, Nov 29, and it’s in the bank Mon, Nov 30.'
      )
    ).toBeInTheDocument();
  });

  it('says when TaskMint can’t cover it in time, and when it would be low rather than short', async () => {
    const { store } = await startBudget({
      items: [rentOn('2026-11-11')],
      settings: { balance: { cents: 10_000, asOf: '2026-11-09' } },
      forecast: taskmint(),
    });
    expect(
      screen.getByText(/TaskMint can’t cover it in time: \$200\.00 more earned today would be in the bank/)
    ).toBeInTheDocument();
    store.putDoc(
      'settings~account',
      JSON.stringify({
        balance: { cents: 10_000, asOf: '2026-11-09' },
        horizonDays: 10,
        taskmint: { policy: { kind: 'weekly', weekday: 0, hour: 9 } },
      })
    );
    expect(
      await screen.findByText(
        'TaskMint can’t cover it in time: no withdrawal before the forecast’s end would take more.'
      )
    ).toBeInTheDocument();
    // Below the low mark, not zero
    store.putDoc('item~rent', JSON.stringify(rentOn('2026-11-30')));
    store.putDoc(
      'settings~account',
      JSON.stringify({ balance: { cents: 40_000, asOf: '2026-11-09' }, lowBalanceCents: 20_000 })
    );
    expect(await screen.findByText(/TaskMint could cover it: earn \$100\.00 more/)).toBeInTheDocument();
  });
});

describe('checking the balance as it’s updated', () => {
  const seed = () => ({
    items: [
      item({
        id: 'phone',
        kind: 'bill' as const,
        name: 'Phone',
        schedule: [
          {
            from: '2026-11-05',
            until: null,
            repeat: { every: 'once' as const },
            amountCents: 5_000,
            weekends: 'keep' as const,
          },
        ],
      }),
      item({
        id: 'pay',
        kind: 'income' as const,
        name: 'Pay',
        schedule: [
          {
            from: '2026-11-06',
            until: null,
            repeat: { every: 'once' as const },
            amountCents: 20_000,
            weekends: 'keep' as const,
          },
        ],
      }),
    ],
    settings: { balance: { cents: 100_000, asOf: '2026-11-01' } },
  });

  it('says what was expected, leaves what hasn’t come out to come, and undoes it all', async () => {
    const { user, store } = await startBudget(seed());
    await user.click(screen.getByRole('button', { name: 'Update balance' }));
    const dialog = screen.getByRole('dialog', { name: 'Your balance' });
    const amount = within(dialog).getByLabelText('Balance');
    await user.clear(amount);
    await user.type(amount, '1100');
    // $1,000 less the phone, plus pay
    expect(within(dialog).getByText(/BudgetMint expected \$1,150\.00 by the end of Nov 10\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/You have \$50\.00 less: spending besides your bills/)).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'Pay: +$200.00, due Nov 6' })).toBeChecked();
    // The phone bill hasn't come out yet: more was expected now
    await user.click(within(dialog).getByRole('checkbox', { name: 'Phone: $50.00, due Nov 5' }));
    expect(within(dialog).getByText(/BudgetMint expected \$1,200\.00/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Phone: $50.00, due Nov 5' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Phone: $50.00, due Nov 5' }));
    await user.clear(amount);
    await user.type(amount, '1200');
    expect(within(dialog).getByText(/That’s just what you have\./)).toBeInTheDocument();
    await user.clear(amount);
    await user.type(amount, '1250');
    expect(within(dialog).getByText(/You have \$50\.00 more than that\./)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(docOf(store, 'occ~2026-11-05~phone')).toMatchObject({ status: { state: 'open' }, movedTo: '2026-11-11' });
    expect(docOf(store, 'occ~2026-11-06~pay').status).toEqual({ state: 'done', on: '2026-11-06', amountCents: 20_000 });
    const settings = docOf(store, 'settings~account');
    expect(settings.balance).toEqual({ cents: 125_000, asOf: '2026-11-10' });
    expect(settings.checks).toHaveLength(1);
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.docs.has('occ~2026-11-06~pay')).toBe(false));
  });

  it('says what to fix, and what it can’t set', async () => {
    const { user } = await startBudget(seed());
    await user.click(screen.getByRole('button', { name: 'Update balance' }));
    const dialog = screen.getByRole('dialog', { name: 'Your balance' });
    // A day still to come: refused; and no check against a date half typed
    fireEvent.change(within(dialog).getByLabelText('As of the end of'), { target: { value: '2026-11-12' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Set the balance as of today or a day before')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('As of the end of'), { target: { value: '' } });
    expect(within(dialog).queryByText(/BudgetMint expected/)).not.toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Balance'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      within(dialog).getByText('Enter what the account holds (a minus sign if it’s overdrawn)')
    ).toBeInTheDocument();
  });
});

describe('reports', () => {
  it('looks back on a month: by category, paid late, besides the bills, six months', async () => {
    const rent = monthly('rent', 'Rent', 1, 100_000, { category: 'Home' });
    const pay = item({
      id: 'pay',
      kind: 'income',
      name: 'Pay',
      schedule: [
        {
          from: '2026-10-15',
          until: null,
          repeat: { every: 'months', n: 1, day: 15 },
          amountCents: 250_000,
          weekends: 'keep',
        },
      ],
    });
    const { user } = await startBudget({
      items: [rent, pay, monthly('water', 'Water', 25, 4_000)],
      overrides: [
        override({
          itemId: 'rent',
          date: '2026-10-01',
          status: { state: 'done', on: '2026-10-03', amountCents: 100_000 },
        }),
        override({
          itemId: 'pay',
          date: '2026-10-15',
          status: { state: 'done', on: '2026-10-15', amountCents: 250_000 },
        }),
      ],
      settings: {
        balance: { cents: 100_000, asOf: '2026-11-09' },
        checks: [
          { from: '2026-10-01', to: '2026-10-11', expectedCents: 50_000, actualCents: 40_000, assumedSpendingCents: 0 },
        ],
      },
    });
    await user.click(screen.getByRole('button', { name: 'Reports' }));
    expect(screen.getByText('November 2026: what came in and went out.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'The month after' })).toBeDisabled();
    // Rent's in the balance (Nov 9): paid; water's still to come
    expect(screen.getByText('Of $1,040.00 expected, $40.00 still to pay')).toBeInTheDocument();
    expect(screen.getByText('So far this month')).toBeInTheDocument();
    expect(screen.getByText('No bill was paid after it was due.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'The month before' }));
    expect(screen.getByText('October 2026: what came in and went out.')).toBeInTheDocument();
    expect(screen.getByText('Money in, less the bills paid')).toBeInTheDocument();
    // October's water, open before the balance's day, is in it: paid
    expect(screen.getByText('Of $1,040.00 expected')).toBeInTheDocument();
    const categories = section('By category');
    expect(within(categories).getByText('Home')).toBeInTheDocument();
    expect(within(categories).getByText('No category (income)')).toBeInTheDocument();
    expect(within(section('Paid late')).getByText('Rent: due Oct 1, paid Oct 3')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Spending besides the bills' })).getByText(
        'About $100.00 over the 10 days your balance updates cover.'
      )
    ).toBeInTheDocument();
    expect(within(section('Six months')).getByText('May 2026')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'The month after' }));
    expect(screen.getByText('November 2026: what came in and went out.')).toBeInTheDocument();

    // A year and more back: some may be missing; before any bill: nothing due
    for (let back = 0; back < 14; back += 1) await user.click(screen.getByRole('button', { name: 'The month before' }));
    expect(screen.getByText(/this month may be missing some/)).toBeInTheDocument();
    expect(screen.getByText('Nothing was due this month.')).toBeInTheDocument();
  });

  it('says a month is short when the bills come to more than came in', async () => {
    const { user } = await startBudget({
      items: [monthly('rent', 'Rent', 1, 100_000)],
      overrides: [
        override({
          itemId: 'rent',
          date: '2026-11-01',
          status: { state: 'done', on: '2026-11-01', amountCents: 100_000 },
        }),
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Reports' }));
    expect(screen.getByText('Left over').parentElement).toHaveTextContent('-$1,000.00');
  });
});

describe('a bank statement', () => {
  const rentAndPay = () => [
    item({
      id: 'rent',
      kind: 'bill',
      name: 'Rent',
      schedule: [
        { from: '2026-11-01', until: null, repeat: { every: 'once' }, amountCents: 120_000, weekends: 'keep' },
      ],
    }),
    item({
      id: 'power',
      kind: 'bill',
      name: 'City Power',
      schedule: [{ from: '2026-11-03', until: null, repeat: { every: 'once' }, amountCents: 9_000, weekends: 'keep' }],
    }),
    item({
      id: 'gym',
      kind: 'bill',
      name: 'Gym',
      schedule: [{ from: '2026-11-04', until: null, repeat: { every: 'once' }, amountCents: 3_000, weekends: 'keep' }],
    }),
  ];
  const statement = [
    'Date,Description,Amount,Balance',
    '11/01/2026,RENT,-1200.00,800.00',
    '11/03/2026,CITYPOWER,-91.40,708.60',
    '11/04/2026,GYM,-30.00,678.60',
    '11/07/2026,COFFEE,-4.50,674.10',
    'Pending,,,',
  ].join('\n');

  async function importing(text: string, seed: Parameters<typeof startBudget>[0] = {}) {
    const started = await startBudget({ items: rentAndPay(), ...seed });
    await started.user.click(screen.getByRole('button', { name: 'Settings' }));
    const data = section('Your data');
    const choose = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    await started.user.click(within(data).getByRole('button', { name: 'Import a bank statement…' }));
    expect(choose).toHaveBeenCalled();
    choose.mockRestore();
    await started.user.upload(within(data).getByLabelText('Bank statement file'), new File([text], 'statement.csv'));
    return { ...started, data };
  }

  it('marks the bills it shows paid, and takes its balance, with Undo', async () => {
    const { user, store } = await importing(statement, {
      overrides: [
        override({
          itemId: 'gym',
          date: '2026-11-04',
          status: { state: 'done', on: '2026-11-04', amountCents: 3_000 },
        }),
      ],
    });
    const dialog = await screen.findByRole('dialog', { name: 'Bank statement' });
    expect(
      within(dialog).getByText('4 transactions, Nov 1, 2026 to Nov 7, 2026. 1 lines didn’t read as one.')
    ).toBeInTheDocument();
    const rent = within(dialog).getByRole('checkbox', { name: 'Rent, due Nov 1: $1,200.00 on Nov 1' });
    const power = within(dialog).getByRole('checkbox', {
      name: 'City Power, due Nov 3: $91.40 on Nov 3 (expected $90.00)',
    });
    expect(rent).toBeChecked();
    expect(
      within(dialog).getByText('1 marked paid already; 1 that aren’t bills or income in BudgetMint.')
    ).toBeInTheDocument();
    const balance = within(dialog).getByRole('checkbox', {
      name: 'Set your balance to $674.10, as of the end of Nov 7, 2026',
    });
    await user.click(power);
    await user.click(power);
    await user.click(power);
    // The balance left as it is
    await user.click(balance);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(docOf(store, 'occ~2026-11-01~rent').status).toEqual({
      state: 'done',
      on: '2026-11-01',
      amountCents: 120_000,
    });
    expect(store.docs.has('occ~2026-11-03~power')).toBe(false);
    expect(docOf(store, 'settings~account').balance).toEqual({ cents: 100_000, asOf: '2026-11-09' });
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.docs.has('occ~2026-11-01~rent')).toBe(false));
  });

  it('asks which columns are which when it can’t tell', async () => {
    const { user, store } = await importing('When,What,How much\n2026-11-01,Rent,-1200\n2026-11-02,Other,-5\n');
    const dialog = await screen.findByRole('dialog', { name: 'Bank statement' });
    expect(within(dialog).getByText(/can’t tell this file’s columns apart/)).toBeInTheDocument();
    const read = within(dialog).getByRole('button', { name: 'Read it' });
    expect(read).toBeDisabled();
    await pick(user, dialog, 'Date', 'When');
    await pick(user, dialog, 'Description', 'What');
    await pick(user, dialog, 'Amount (out below zero)', 'How much');
    await pick(user, dialog, 'Or money out', 'How much');
    await pick(user, dialog, 'Or money out', 'None');
    await user.click(read);
    expect(within(dialog).getByRole('checkbox', { name: 'Rent, due Nov 1: $1,200.00 on Nov 1' })).toBeChecked();
    // Nothing to save once it's unticked and there's no balance in it
    await user.click(within(dialog).getByRole('checkbox', { name: /Rent/ }));
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(store.docs.has('occ~2026-11-01~rent')).toBe(false);
  });

  it('says what it can’t read, or save', async () => {
    const { user, data } = await importing('nothing here,');
    // A CSV it can't find columns in, one of them without a name
    const dialog = await screen.findByRole('dialog', { name: 'Bank statement' });
    await user.click(within(dialog).getByLabelText('Date'));
    expect(screen.getByRole('option', { name: 'nothing here' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Column 2' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    // Escape closes it, as Cancel does
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.upload(within(data).getByLabelText('Bank statement file'), new File(['\n \n'], 'empty.csv'));
    expect(
      await within(data).findByText(
        'That file isn’t a bank statement BudgetMint can read: export it as CSV or OFX'.replace('’', "'")
      )
    ).toBeInTheDocument();
    fireEvent.change(within(data).getByLabelText('Bank statement file'), { target: { files: [] } });

    // An OFX with nothing in it, but a balance a day still to come
    await user.upload(
      within(data).getByLabelText('Bank statement file'),
      new File(['<OFX><STMTRS><LEDGERBAL><BALAMT>10.00<DTASOF>20261120</LEDGERBAL></STMTRS></OFX>'], 's.ofx')
    );
    const ofx = await screen.findByRole('dialog', { name: 'Bank statement' });
    expect(within(ofx).getByText('No transactions in it.')).toBeInTheDocument();
    expect(within(ofx).getByText('None of it matches a bill or income still open.')).toBeInTheDocument();
    await user.click(within(ofx).getByRole('button', { name: 'Save' }));
    expect(within(ofx).getByText('Set the balance as of today or a day before')).toBeInTheDocument();
  });

  it('takes the statement’s balance', async () => {
    const { user, store } = await importing(
      '<OFX><STMTTRN><DTPOSTED>20261101<TRNAMT>-1200.00<NAME>RENT</STMTTRN><LEDGERBAL><BALAMT>800.00<DTASOF>20261107</LEDGERBAL></OFX>'
    );
    const dialog = await screen.findByRole('dialog', { name: 'Bank statement' });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(docOf(store, 'settings~account').balance).toEqual({ cents: 80_000, asOf: '2026-11-07' })
    );
  });

  it('says when the columns chosen don’t read', async () => {
    const { user, core } = await importing('A,B\n1,2\n');
    const dialog = await screen.findByRole('dialog', { name: 'Bank statement' });
    // Neither row has a date in the column chosen
    await pick(user, dialog, 'Date', 'A');
    await pick(user, dialog, 'And money in', 'B');
    // Core refusing: said, and the columns can be chosen again
    vi.spyOn(core, 'call').mockImplementationOnce(() => {
      throw new Error('BudgetMint ran into a problem');
    });
    await user.click(within(dialog).getByRole('button', { name: 'Read it' }));
    expect(within(dialog).getByText('BudgetMint ran into a problem')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Read it' }));
    expect(within(dialog).getByText('No transactions in it. 2 lines didn’t read as one.')).toBeInTheDocument();
    expect(within(dialog).queryByText('BudgetMint ran into a problem')).not.toBeInTheDocument();
  });
});
