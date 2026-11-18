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
import { notificationsNoticedKey } from '../hooks/useReminders';
import { createFakeShell } from '../testing';
import { readLocal } from '../utils/localStore';

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
    await pick(user, dialog, 'Repeats', 'Something else…');
    await pick(user, dialog, 'Every', 'Monthly on a weekday');
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
    await pick(user, dialog, 'Repeats', 'Every year');
    await user.click(within(dialog).getByRole('switch', { name: /Set money aside for it each month/ }));
    // Every few days, there's no time to save: the switch goes
    await pick(user, dialog, 'Repeats', 'Something else…');
    await pick(user, dialog, 'Every', 'Every… days');
    expect(within(dialog).queryByRole('switch', { name: /Set money aside/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('On a weekend')).not.toBeInTheDocument();
    await pick(user, dialog, 'Every', 'Every… years');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(itemNamed(store, 'Car insurance').saveUp).toEqual({ since: '2026-11-10' });
    expect(screen.getByText('Setting aside')).toBeInTheDocument();
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
  it('lists an archived goal, and brings it back from there', async () => {
    const { user, store } = await startBudget({
      items: [monthly('car', 'Car insurance', 3, 60_000, { archived: true, saveUp: { since: '2026-01-01' } })],
    });
    await user.click(screen.getByRole('button', { name: 'Savings' }));
    const archived = screen.getByRole('region', { name: 'Archived' });
    await user.click(within(archived).getByRole('button', { name: 'Bring back Car insurance' }));
    expect(await screen.findByText('Car insurance brought back')).toBeInTheDocument();
    await waitFor(() => expect(itemNamed(store, 'Car insurance').archived).toBe(false));
    expect(screen.queryByRole('region', { name: 'Archived' })).not.toBeInTheDocument();
  });

  it('starts a goal from what’s set aside already, as a document older BudgetMints hold', async () => {
    const { user, store } = await startBudget();
    await user.click(screen.getByRole('button', { name: 'Savings' }));
    await user.click(screen.getAllByRole('button', { name: 'Add a goal' })[0]);
    let dialog = screen.getByRole('dialog', { name: 'Add a savings goal' });
    await user.type(within(dialog).getByLabelText('Name'), 'Trip');
    await user.type(within(dialog).getByLabelText('Amount'), '1000');
    fireEvent.change(within(dialog).getByLabelText('On'), { target: { value: '2027-03-15' } });
    expect(within(dialog).getByText(/What you’ve set aside for it already/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Already set aside (optional)'), '300');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const trip = itemNamed(store, 'Trip');
    expect(trip.saveUp).toEqual({ since: '2026-11-10', savedCents: 30_000 });
    // Written as schema 3: a BudgetMint before it holds it rather than drop what's set aside
    expect(store.writes.at(-1)!.writes[0]).toMatchObject({ docId: `item~${trip.id}`, schema: 3 });
    const card = screen.getByRole('region', { name: 'Trip' });
    // $300 now; the $700 left over the four months to March 15
    expect(within(card).getByText('$300.00 of $1,000.00')).toBeInTheDocument();
    expect(within(card).getByText('Next $175.00 on Dec 10, 2026, then 3 more.')).toBeInTheDocument();

    // Edited: said what's set aside so far; left empty, it stays
    await user.click(within(card).getByRole('button', { name: 'Edit Trip' }));
    dialog = screen.getByRole('dialog', { name: 'Edit Trip' });
    expect(within(dialog).getByText(/\$300\.00 set aside so far/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Name'), '!');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(itemNamed(store, 'Trip!')).toBeDefined());
    expect(itemNamed(store, 'Trip!').saveUp).toEqual({ since: '2026-11-10', savedCents: 30_000 });
  });

  it('archives a goal, deletes one, and warns before what’s set aside is let go', async () => {
    const saved = (id: string, name: string) =>
      item({
        id,
        kind: 'bill',
        name,
        saveUp: { since: '2026-01-01' },
        schedule: [
          { from: '2027-03-03', until: null, repeat: { every: 'years', n: 1 }, amountCents: 120_000, weekends: 'keep' },
        ],
      });
    const { user, store, core } = await startBudget({
      items: [saved('car', 'Car insurance'), saved('trip', 'Trip'), saved('tax', 'Tax')],
    });
    await user.click(screen.getByRole('button', { name: 'Savings' }));
    await user.click(screen.getByRole('button', { name: 'Archive Trip' }));
    expect(await screen.findByText('Trip archived')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Trip' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete Tax' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete Tax?' })).getByRole('button', { name: 'Delete' })
    );
    await waitFor(() => expect(store.docs.has('item~tax')).toBe(false));
    // Turning it off lets go of what's set aside: said before it's saved
    // (once the question has gone: until then the page is hidden from screen readers)
    await user.click(await screen.findByRole('button', { name: 'Edit Car insurance' }));
    await user.click(screen.getByRole('switch', { name: /Set money aside for it each month/ }));
    expect(screen.getByText(/What's set aside for it so far is let go/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    // Something was changed: Cancel asks first
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Gone on another device meanwhile: said in a toast
    core.call('apply_docs', { docs: [{ docId: 'item~car', json: null, schema: 1 }] });
    await user.click(screen.getByRole('button', { name: 'Archive Car insurance' }));
    expect(await screen.findByText("That bill isn't there any more (deleted on another device?)")).toBeInTheDocument();
  });

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
    expect(within(dialog).getByRole('switch', { name: /Set money aside for it each month until then/ })).toBeChecked();
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
    expect(screen.getByText('Nothing set aside yet')).toBeInTheDocument();
    expect(
      screen.getByText('Set money aside a month at a time for yearly bills and things to come.')
    ).toBeInTheDocument();
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
        'It stays above $0.00 through Jan 9, after $70.00 a week of everyday spending and $100.00 set aside'
      )
    ).toBeInTheDocument();

    // The forecast takes a day's share each day, and draws the balance besides what's set aside
    await user.click(screen.getByRole('button', { name: 'Forecast' }));
    expect(screen.getByText('Everyday spending: $70.00 a week, a day’s share each day.')).toBeInTheDocument();
    expect(screen.getByText('The dashed balance line leaves out the money set aside.')).toBeInTheDocument();
    // (Each line stands for the days since the one listed before)
    expect(screen.getAllByText(/^Everyday spending(, \d+ days)?$/).length).toBeGreaterThan(0);
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
      await screen.findByText(/^Nothing to spare: after \$100\.00 set aside, it gets to -\$[\d,.]+ on \w+, \w+ \d+$/)
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
    // Empty, with the last one to go by
    expect(amount).toHaveValue('');
    expect(within(dialog).getByText('Last: $1,000.00, at the end of Nov 1')).toBeInTheDocument();
    await user.type(amount, '1100');
    // Nothing ticked: both still to come
    const pay = within(dialog).getByRole('checkbox', { name: 'Pay: +$200.00, due Nov 6' });
    const phone = within(dialog).getByRole('checkbox', { name: 'Phone: $50.00, due Nov 5' });
    expect(pay).not.toBeChecked();
    expect(within(dialog).getByText(/BudgetMint expected \$1,000\.00 by the end of Nov 10\./)).toBeInTheDocument();
    // Both came: $1,000 less the phone, plus pay
    await user.click(within(dialog).getByRole('button', { name: 'Tick all' }));
    expect(pay).toBeChecked();
    expect(within(dialog).getByText(/BudgetMint expected \$1,150\.00 by the end of Nov 10\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/You have \$50\.00 less: spending besides your bills/)).toBeInTheDocument();
    // The phone came to $60: what was expected follows
    const came = within(dialog).getByLabelText('What Phone came to');
    expect(came).toHaveValue('50.00');
    await user.clear(came);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Enter what it came to')).toBeInTheDocument();
    await user.type(came, '60');
    expect(within(dialog).getByText(/BudgetMint expected \$1,140\.00/)).toBeInTheDocument();
    // The phone bill hasn't come out yet after all: more was expected now
    await user.click(phone);
    expect(within(dialog).getByText(/BudgetMint expected \$1,200\.00/)).toBeInTheDocument();
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
    const water = monthly('water', 'Water', 8, 3_000, { varies: true });
    const { user } = await startBudget({ ...seed(), items: [...seed().items, water] });
    await user.click(screen.getByRole('button', { name: 'Update balance' }));
    const dialog = screen.getByRole('dialog', { name: 'Your balance' });
    // A day still to come: refused; and no check against a date half typed
    await user.type(within(dialog).getByLabelText('Balance'), '1000');
    fireEvent.change(within(dialog).getByLabelText('As of'), { target: { value: '2026-11-12' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Set the balance as of today or a day before')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('As of'), { target: { value: '' } });
    expect(within(dialog).queryByText(/BudgetMint expected/)).not.toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Balance'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      within(dialog).getByText('Enter what the bank account holds (a minus sign if it’s overdrawn)')
    ).toBeInTheDocument();
    // An amount that varies starts empty when ticked
    fireEvent.change(within(dialog).getByLabelText('As of'), { target: { value: '2026-11-10' } });
    await user.type(within(dialog).getByLabelText('Balance'), '900');
    await user.click(within(dialog).getByRole('checkbox', { name: /^Water/ }));
    expect(within(dialog).getByLabelText('What Water came to')).toHaveValue('');
  });
});

describe('reports', () => {
  it('shows what the bank statements kept were spent on, by category, each opening to its transactions', async () => {
    const { user, store } = await startBudget({});
    await user.click(screen.getByRole('button', { name: 'Reports' }));
    expect(screen.queryByRole('heading', { name: 'Spending, by your bank statements' })).not.toBeInTheDocument();
    const line = (
      id: string,
      on: string,
      amountCents: number,
      name: string,
      category: string | null,
      flow = 'spend'
    ) => ({
      id,
      on,
      amountCents,
      name,
      category,
      flow,
      itemId: null,
    });
    store.putDoc(
      'txns~main~2026-11',
      JSON.stringify({
        accountId: 'main',
        month: '2026-11',
        transactions: [
          line('a', '2026-11-02', -4_500, 'Walmart', 'Groceries'),
          line('b', '2026-11-03', -1_250, 'Cafe', 'Dining'),
          line('c', '2026-11-04', -700, 'Kiosk', null),
          line('d', '2026-11-05', -2_000, 'WinCo Foods', 'groceries'),
          line('e', '2026-11-06', 5_000, 'Add funds', null, 'moved'),
        ],
      }),
      5
    );
    const spending = await screen.findByRole('region', { name: 'Spending, by your bank statements' });
    expect(
      within(spending).getByText('$84.50 spent in the statements imported for this month, bills among it.')
    ).toBeInTheDocument();
    const rows = () =>
      within(spending)
        .getAllByRole('row')
        .map(row => row.textContent);
    expect(rows()).toEqual(['CategoryTransactionsSpent', 'Groceries2$65.00', 'Dining1$12.50', 'No category1$7.00']);
    await user.click(within(spending).getByRole('button', { name: 'Groceries' }));
    expect(rows().slice(1, 4)).toEqual(['Groceries2$65.00', 'WalmartNov 2$45.00', 'WinCo FoodsNov 5$20.00']);
    await user.click(within(spending).getByRole('button', { name: 'No category' }));
    expect(rows()).toContain('KioskNov 4$7.00');
    expect(rows()).not.toContain('WalmartNov 2$45.00');
    await user.click(within(spending).getByRole('button', { name: 'No category' }));
    expect(rows()).toHaveLength(4);
    // Another month has none
    await user.click(screen.getByRole('button', { name: 'The month before' }));
    expect(screen.queryByRole('heading', { name: 'Spending, by your bank statements' })).not.toBeInTheDocument();
  });

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
    expect(screen.getByText('So far: money in, less the bills paid')).toBeInTheDocument();
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

describe('reports, besides', () => {
  it('say what left over is before, chart six months, and download a month', async () => {
    const shell = (await import('../testing')).createFakeShell();
    const { user } = await startBudget({
      shell,
      items: [monthly('rent', 'Rent', 1, 100_000)],
      settings: { balance: { cents: 100_000, asOf: '2026-11-09' }, spendingWeeklyCents: 7_000 },
    });
    await user.click(screen.getByRole('button', { name: 'Reports' }));
    expect(
      screen.getByText('So far: money in, less the bills paid, before about $100.00 of everyday spending')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download this month' }));
    await waitFor(() =>
      expect(shell.platform.saveFile).toHaveBeenCalledWith(
        'budgetmint-2026-11.csv',
        expect.stringContaining('2026-11-01,Rent,Bill'),
        'text/csv'
      )
    );
    vi.mocked(shell.platform.saveFile!).mockRejectedValueOnce(new Error('the disk is full'));
    await user.click(screen.getByRole('button', { name: 'Download this month' }));
    expect(await screen.findByText('It wasn’t saved: the disk is full')).toBeInTheDocument();
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
      // Rent has a category: what pays it is kept in it
      items: rentAndPay().map(bill => (bill.id === 'rent' ? { ...bill, category: 'Home' } : bill)),
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
      within(dialog).getByText(
        '4 transactions, Nov 1, 2026 to Nov 7, 2026. 1 line didn’t read as one. 4 out (-$1,325.90).'
      )
    ).toBeInTheDocument();
    const rent = within(dialog).getByRole('checkbox', { name: 'Rent, due Nov 1: -$1,200.00 on Nov 1' });
    const power = within(dialog).getByRole('checkbox', {
      name: 'City Power, due Nov 3: -$91.40 on Nov 3 (expected $90.00)',
    });
    expect(rent).toBeChecked();
    expect(within(dialog).getByText('1 marked paid already.')).toBeInTheDocument();
    // What was spent, as it will be kept: rent where the bill is, coffee where coffee goes
    const spent = within(dialog).getByRole('group', { name: 'Spent, by category' });
    expect(within(spent).getByText('Home: $1,200.00')).toBeInTheDocument();
    expect(within(spent).getByText('Dining: $4.50')).toBeInTheDocument();
    expect(within(spent).getByText('No category: $121.40')).toBeInTheDocument();
    // A to Z, what has no category last
    expect(Array.from(spent.children, chip => chip.textContent)).toEqual([
      'Dining: $4.50',
      'Home: $1,200.00',
      'No category: $121.40',
    ]);
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
    // Every line is kept, in its month: the rent's with the bill it paid
    expect(store.docs.get('txns~main~2026-11')!.schema).toBe(5);
    expect(docOf(store, 'txns~main~2026-11').transactions).toMatchObject([
      { on: '2026-11-01', amountCents: -120_000, name: 'Rent', category: 'Home', flow: 'spend', itemId: 'rent' },
      { on: '2026-11-03', name: 'Citypower', category: null, itemId: 'power' },
      { on: '2026-11-04', name: 'Gym', category: null, itemId: null },
      { on: '2026-11-07', name: 'Coffee', category: 'Dining', itemId: null },
    ]);
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.docs.has('occ~2026-11-01~rent')).toBe(false));
    expect(store.docs.has('txns~main~2026-11')).toBe(false);
  });

  it('is imported from Bills too, each line put in a category, renamed or matched by hand', async () => {
    const water = item({
      id: 'water',
      kind: 'bill',
      name: 'Water',
      category: 'Utilities',
      schedule: [{ from: '2026-11-06', until: null, repeat: { every: 'once' }, amountCents: 2_500, weekends: 'keep' }],
    });
    const { user, store } = await startBudget({ items: [...rentAndPay(), water] });
    await user.click(screen.getByRole('button', { name: 'Bills' }));
    const choose = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    await user.click(screen.getByRole('button', { name: 'Import a bank statement' }));
    expect(choose).toHaveBeenCalled();
    choose.mockRestore();
    // A file that isn't a statement: said in a toast
    await user.upload(screen.getByLabelText('Bank statement file'), new File(['\n \n'], 'empty.csv'));
    expect(await screen.findByText(/That file isn.t a bank statement BudgetMint can read/)).toBeInTheDocument();
    const text = [
      ...statement.split('\n').slice(0, 5),
      '11/06/2026,AQUA CO,-27.00,647.10',
      '11/08/2026,,25.00,672.10',
      '11/09/2026,COFFEE,-5.50,666.60',
    ].join('\n');
    await user.upload(screen.getByLabelText('Bank statement file'), new File([text], 'statement.csv'));
    const dialog = await screen.findByRole('dialog', { name: 'Bank statement' });
    const others = within(dialog).getByRole('group', { name: 'What else it shows' });
    // By who it was paid to, with what's known of them: two coffees, in Dining
    const coffee = within(others).getByRole('group', { name: 'Coffee' });
    expect(within(coffee).getByRole('button', { name: 'Coffee (2) -$10.00' })).toBeInTheDocument();
    expect(within(coffee).getByLabelText('Category for Coffee')).toHaveValue('Dining');
    expect(within(others).getByLabelText('Category for these')).toHaveValue('');
    // Only what has no category yet, to go through
    await user.click(within(others).getByRole('switch', { name: 'Only what has no category (2)' }));
    expect(within(others).queryByRole('group', { name: 'Coffee' })).not.toBeInTheDocument();
    // One given a category stays where it is while only those are shown: just the count says so
    const these = within(others).getByLabelText('Category for these');
    await user.type(these, 'Misc');
    expect(within(others).getByRole('switch', { name: 'Only what has no category (2)' })).toBeInTheDocument();
    await user.tab();
    expect(within(others).getByRole('switch', { name: 'Only what has no category (1)' })).toBeInTheDocument();
    expect(within(others).getByRole('group', { name: 'No description' })).toBeInTheDocument();
    await user.clear(these);
    await user.click(within(others).getByRole('switch', { name: 'Only what has no category (2)' }));
    // In the order it was read in: what had no category first, then the most money
    const order = () =>
      within(others)
        .getAllByRole('group')
        .map(group => group.getAttribute('aria-label'));
    expect(order()).toEqual(['Aqua Co', 'No description', 'Coffee']);
    // Another category for coffee: for both lines, and remembered. Nothing moves as it's emptied, or
    // while it's typed; it's taken when the field is left
    const category = within(others).getByLabelText('Category for Coffee');
    await user.clear(category);
    expect(within(others).getByRole('switch', { name: 'Only what has no category (3)' })).toBeInTheDocument();
    await user.type(category, 'Treats');
    expect(within(dialog).queryByText('Treats: $10.00')).not.toBeInTheDocument();
    await user.tab();
    expect(within(dialog).getByText('Treats: $10.00')).toBeInTheDocument();
    expect(order()).toEqual(['Aqua Co', 'No description', 'Coffee']);
    // One of the categories there are, picked
    await user.clear(category);
    await user.click(category);
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Dining', 'Utilities']);
    await user.click(screen.getByRole('option', { name: 'Utilities' }));
    expect(within(dialog).getByText('Utilities: $10.00')).toBeInTheDocument();
    // Typed in other letters and entered: the same category to pick, once, as it was first spelled
    await user.clear(category);
    await user.type(category, 'dining{Enter}');
    expect(within(dialog).getByText('dining: $10.00')).toBeInTheDocument();
    await user.click(these);
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Dining', 'Utilities']);
    await user.keyboard('{Escape}');
    await user.clear(category);
    await user.type(category, 'Treats');
    await user.tab();
    // The water bill went out as AQUA CO: opened, its line is renamed, put where it goes and matched by hand
    const aqua = within(others).getByRole('group', { name: 'Aqua Co' });
    const opener = within(aqua).getByRole('button', { name: 'Aqua Co -$27.00' });
    expect(opener).not.toHaveAttribute('aria-controls');
    await user.click(opener);
    expect(document.getElementById(opener.getAttribute('aria-controls')!)).toBeInTheDocument();
    expect(within(aqua).getByText('AQUA CO')).toBeInTheDocument();
    // Its day and amount stand over its fields, and name them
    const line = within(aqua).getByRole('group', { name: 'Nov 6, -$27.00' });
    // The merchant's category is each of its lines', until a line has its own
    const whole = within(aqua).getByLabelText('Category for Aqua Co');
    await user.type(whole, 'Bills');
    await user.tab();
    expect(within(line).getByLabelText('Category')).toHaveValue('Bills');
    await user.clear(whole);
    expect(within(line).getByLabelText('Category')).toHaveValue('');
    const name = within(line).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Water company');
    await user.type(within(line).getByLabelText('Category'), 'Utilities');
    await user.click(within(line).getByLabelText('It paid'));
    expect(screen.getByRole('option', { name: 'No bill or income here' })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Water, due Nov 6' }));
    // Money in, without a description: nothing here it could have been
    const unnamed = within(others).getByRole('group', { name: 'No description' });
    await user.click(within(unnamed).getByRole('button', { name: 'No description +$25.00' }));
    expect(within(aqua).queryByLabelText(/^Name/)).not.toBeInTheDocument();
    expect(within(within(unnamed).getByRole('group', { name: 'Nov 8, +$25.00' })).getByLabelText('Name')).toHaveValue(
      ''
    );
    expect(within(unnamed).queryByLabelText(/^It paid/)).not.toBeInTheDocument();
    await user.click(within(unnamed).getByRole('button', { name: 'No description +$25.00' }));
    expect(within(unnamed).queryByLabelText(/^Name/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('checkbox', { name: /Set your balance/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(docOf(store, 'occ~2026-11-06~water').status).toEqual({
      state: 'done',
      on: '2026-11-06',
      amountCents: 2_700,
    });
    const kept = docOf(store, 'txns~main~2026-11').transactions as { name: string }[];
    expect(kept.find(line => line.name === 'Water company')).toMatchObject({ category: 'Utilities', itemId: 'water' });
    expect(kept.filter(line => line.name === 'Coffee')).toMatchObject([{ category: 'Treats' }, { category: 'Treats' }]);
    expect(kept.find(line => line.name === 'From the bank')).toMatchObject({ flow: 'income', category: null });
    expect(docOf(store, 'settings~account').categoryRules).toEqual([{ merchant: 'coffee', category: 'Treats' }]);
    expect(store.docs.get('settings~account')!.schema).toBe(5);

    // The next statement: coffee where it was put, and the lines kept before known
    const next = [text, '11/10/2026,COFFEE,-3.00,663.60'].join('\n');
    await user.upload(screen.getByLabelText('Bank statement file'), new File([next], 'statement.csv'));
    const again = await screen.findByRole('dialog', { name: 'Bank statement' });
    expect(
      within(again).getByText(
        '8 transactions, Nov 1, 2026 to Nov 10, 2026. 7 are kept already, from a statement before. 1 out (-$3.00).'
      )
    ).toBeInTheDocument();
    expect(within(again).getByLabelText('Category for Coffee')).toHaveValue('Treats');
    expect(within(again).getByRole('button', { name: 'Coffee -$3.00' })).toBeInTheDocument();
  });

  it('offers what comes round as bills and income, to add with it', async () => {
    const { user, store } = await startBudget({ settings: { balance: { cents: 100_000, asOf: '2026-11-09' } } });
    await user.click(screen.getByRole('button', { name: 'Bills' }));
    const summer = [
      'Date,Description,Amount',
      '2026-07-13,CITY POWER,-90.00',
      '2026-08-12,CITY POWER,-120.00',
      '2026-08-28,NETFLIX.COM,-19.99',
      '2026-09-14,CITY POWER,-100.00',
      '2026-09-25,ACME PAYROLL,1500.00',
      '2026-09-28,NETFLIX.COM,-19.99',
    ].join('\n');
    const fall = [
      'Date,Description,Amount',
      '2026-09-28,NETFLIX.COM,-19.99',
      '2026-10-09,ACME PAYROLL,1500.00',
      '2026-10-13,CITY POWER,-110.00',
      '2026-10-23,ACME PAYROLL,1500.00',
      '2026-10-28,NETFLIX.COM,-19.99',
    ].join('\n');
    // Two months' files, as one statement: the line in both is read once
    await user.upload(screen.getByLabelText('Bank statement file'), [
      new File([summer], 'summer.csv'),
      new File([fall], 'fall.csv'),
    ]);
    const dialog = await screen.findByRole('dialog', { name: 'Bank statement' });
    expect(
      within(dialog).getByText('10 transactions, Jul 13, 2026 to Oct 28, 2026. 7 out (-$479.97), 3 in (+$4,500.00).')
    ).toBeInTheDocument();
    const round = within(dialog).getByRole('group', { name: 'What comes round' });
    const netflix = within(round).getByRole('checkbox', {
      name: 'Netflix: $19.99, monthly on the 28th, next Nov 28 · Subscriptions',
    });
    expect(netflix).not.toBeChecked();
    expect(
      within(round).getByRole('checkbox', { name: 'City Power: about $110.00, monthly on the 13th, next Nov 13' })
    ).toBeInTheDocument();
    expect(
      within(round).getByRole('checkbox', {
        name: 'Acme Payroll (income): $1,500.00, every 2 weeks on friday, next Nov 6',
      })
    ).toBeInTheDocument();
    await user.click(netflix);
    await user.click(netflix);
    await user.click(netflix);
    // Edited first, in the bill's own form: as it's left there is how it's added
    await user.click(within(round).getByRole('button', { name: 'Edit Acme Payroll' }));
    const form = screen.getByRole('dialog', { name: 'Add income' });
    const name = within(form).getByLabelText('Name');
    expect(name).toHaveValue('Acme Payroll');
    await user.clear(name);
    await user.type(name, 'Paycheck');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add income' })).not.toBeInTheDocument());
    expect(
      within(round).getByRole('checkbox', { name: 'Paycheck (income): $1,500.00, every 2 weeks on friday, next Nov 6' })
    ).toBeChecked();
    // Edited again, it starts from how it was left
    await user.click(within(round).getByRole('button', { name: 'Edit Paycheck' }));
    const formAgain = screen.getByRole('dialog', { name: 'Add income' });
    expect(within(formAgain).getByLabelText('Name')).toHaveValue('Paycheck');
    await user.click(within(formAgain).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add income' })).not.toBeInTheDocument());
    // Something was chosen: leaving asks first
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    const asking = await screen.findByRole('dialog', { name: 'Leave the statement unsaved?' });
    await user.click(within(asking).getByRole('button', { name: 'Keep going' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Leave the statement unsaved?' })).toBeNull());
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(itemNamed(store, 'Netflix')).toMatchObject({
      kind: 'bill',
      category: 'Subscriptions',
      varies: false,
      reminder: { leadDays: [3] },
      schedule: [{ from: '2026-11-28', repeat: { every: 'months', n: 1, day: 28 }, amountCents: 1_999 }],
    });
    expect(itemNamed(store, 'Paycheck')).toMatchObject({
      kind: 'income',
      reminder: null,
      schedule: [{ from: '2026-11-06', repeat: { every: 'weeks', n: 2 }, amountCents: 150_000 }],
    });
    expect(itemNamed(store, 'City Power')).toBeUndefined();
    expect(docOf(store, 'txns~main~2026-09').transactions).toHaveLength(3);
    // One undo takes all of it back
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(itemNamed(store, 'Netflix')).toBeUndefined());
    expect(store.docs.has('txns~main~2026-09')).toBe(false);
  });

  it('reads Venmo’s statement: who was paid, cash back and money moved apart, and what isn’t settled left out', async () => {
    const row = (
      id: string,
      at: string,
      kind: string,
      status: string,
      said: [string, string, string],
      amount: string
    ) => `,${id},${at},${kind},${status},${said.join(',')},${amount},,,,,,Venmo balance,,,,,"BOISE, ID",,`;
    const venmo = [
      'Account Statement - (@pat) ,,,,,,,,,,,,,,,,,,,,,',
      'Account Activity,,,,,,,,,,,,,,,,,,,,,',
      ',ID,Datetime,Type,Status,Note,From,To,Amount (total),Amount (tip),Amount (tax),Amount (fee),Tax Rate,Tax Exempt,Funding Source,Destination,Beginning Balance,Ending Balance,Statement Period Venmo Fees,Terminal Location,Year to Date Venmo Fees,Disclaimer',
      ',,,,,,,,,,,,,,,,$100.00,,,,,',
      row(
        '111',
        '2026-11-01T01:20:03',
        'Venmo Card Transaction',
        'Complete',
        ['', 'Pat Doe', 'WM SUPERCENTER #2780'],
        '- $18.30'
      ),
      row(
        '112',
        '2026-11-01T17:38:37Z',
        'Reward',
        'Complete',
        ['Cash back on your purchase at WM SUPERCENTER', '', 'pat'],
        '+ $0.92'
      ),
      row('113', '2026-11-02T18:26:59', 'Instant Add Funds', 'Complete', ['', '', ''], '+ $50.00'),
      row('114', '2026-11-04T00:46:36', 'Venmo Card Transaction', 'Pending', ['', 'Pat Doe', 'The Habit'], '- $9.31'),
      ',,,,,,,,,,,,,,,,,$132.62,$0.00,,$0.00,"In case of errors\n   call us"',
      'Cryptocurrency summary,,,,,,,,,,,,,,,,,,,,,',
    ].join('\n');
    const { user, store } = await importing(venmo);
    const dialog = await screen.findByRole('dialog', { name: 'Bank statement' });
    expect(
      within(dialog).getByText(
        '3 transactions, Nov 1, 2026 to Nov 2, 2026. 1 isn’t settled yet: left for a later statement. 1 out (-$18.30).'
      )
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Walmart -$18.30' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Category for Walmart')).toHaveValue('Groceries');
    expect(within(dialog).getByText('1 of cash back (+$0.92): kept, and not counted as income.')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        '1 of your own money moved in or out (+$50.00): kept, and counted as neither spending nor income.'
      )
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('checkbox', { name: 'Set your balance to $132.62, as of the end of Nov 2, 2026' })
    ).toBeChecked();
    // Nothing touched and nothing to mark paid: leaving doesn't ask
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.upload(screen.getByLabelText('Bank statement file'), new File([venmo], 'venmo.csv'));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Bank statement' })).getByRole('button', { name: 'Save' })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(docOf(store, 'txns~main~2026-11').transactions).toMatchObject([
      { id: '111', name: 'Walmart', category: 'Groceries', flow: 'spend' },
      { id: '112', name: 'Walmart', category: null, flow: 'reward' },
      { id: '113', name: 'Instant Add Funds', category: null, flow: 'moved' },
    ]);
    expect(docOf(store, 'settings~account').balance).toEqual({ cents: 13_262, asOf: '2026-11-02' });
    // Read again: all of it is kept already, and without its balance there's nothing to save
    await user.upload(screen.getByLabelText('Bank statement file'), new File([venmo], 'venmo.csv'));
    const again = await screen.findByRole('dialog', { name: 'Bank statement' });
    expect(within(again).getByText(/3 are kept already, from a statement before\./)).toBeInTheDocument();
    await user.click(within(again).getByRole('checkbox', { name: /Set your balance/ }));
    expect(within(again).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('is offered from the Overview’s Add too', async () => {
    const { user } = await startBudget({ items: rentAndPay() });
    const choose = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('menuitem', { name: 'What a bank statement shows…' }));
    expect(choose).toHaveBeenCalled();
    choose.mockRestore();
    await user.upload(screen.getByLabelText('Bank statement file'), new File([statement], 'statement.csv'));
    expect(await screen.findByRole('dialog', { name: 'Bank statement' })).toBeInTheDocument();
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
    expect(within(dialog).getByRole('checkbox', { name: 'Rent, due Nov 1: -$1,200.00 on Nov 1' })).toBeChecked();
    // A click outside keeps it; with something to save, Escape asks before dropping it
    await user.click(document.querySelector('.MuiBackdrop-root')!);
    expect(dialog).toBeInTheDocument();
    within(dialog).getByRole('checkbox', { name: /Rent/ }).focus();
    await user.keyboard('{Escape}');
    const asking = await screen.findByRole('dialog', { name: 'Leave the statement unsaved?' });
    await user.click(within(asking).getByRole('button', { name: 'Keep going' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Leave the statement unsaved?' })).toBeNull());
    // Dropped: nothing of it is marked paid, or kept
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Leave the statement unsaved?' })).getByRole('button', {
        name: 'Discard',
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(store.docs.has('occ~2026-11-01~rent')).toBe(false);
    expect(store.docs.has('txns~main~2026-11')).toBe(false);
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
    expect(
      within(dialog).getByText('1 transaction, Nov 1, 2026 to Nov 1, 2026. 1 out (-$1,200.00).')
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(docOf(store, 'settings~account').balance).toEqual({ cents: 80_000, asOf: '2026-11-07' })
    );
  });

  it('reads a statement the other way round, or by other columns, when asked', async () => {
    // What was spent written above zero, as a card's statement often has it
    const card = [
      'Date,Description,Amount,Way',
      '11/01/2026,GROCER,54.20,debit',
      '11/02/2026,REFUND CO,4.50,credit',
    ].join('\n');
    const { user } = await importing(card);
    const dialog = await screen.findByRole('dialog', { name: 'Bank statement' });
    expect(within(dialog).getByText('2 transactions, Nov 1, 2026 to Nov 2, 2026. 2 in (+$58.70).')).toBeInTheDocument();
    expect(within(dialog).getByText(/Every amount here reads as money in/)).toBeInTheDocument();
    const turn = within(dialog).getByRole('switch', { name: 'Amounts are the other way round' });
    await user.click(turn);
    expect(
      within(dialog).getByText('2 transactions, Nov 1, 2026 to Nov 2, 2026. 2 out (-$58.70).')
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/Every amount here reads as money in/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Grocer -$54.20' })).toBeInTheDocument();
    await user.click(turn);
    expect(within(dialog).getByRole('button', { name: 'Grocer +$54.20' })).toBeInTheDocument();
    // The columns core took, chosen again: they start as they were read, and can be left so
    await user.click(within(dialog).getByRole('button', { name: 'Choose the columns' }));
    expect(within(dialog).getByText('Which of this file’s columns hold what?')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Amount (out below zero)')).toHaveTextContent('Amount');
    await user.click(within(dialog).getByRole('button', { name: 'Leave them as they were' }));
    expect(within(dialog).getByRole('button', { name: 'Grocer +$54.20' })).toBeInTheDocument();
    // One of them says which way each went
    await user.click(within(dialog).getByRole('button', { name: 'Choose the columns' }));
    await pick(user, dialog, 'Says which way (debit or credit)', 'Way');
    await user.click(within(dialog).getByRole('button', { name: 'Read it' }));
    expect(
      within(dialog).getByText('2 transactions, Nov 1, 2026 to Nov 2, 2026. 1 out (-$54.20), 1 in (+$4.50).')
    ).toBeInTheDocument();
    // Read the other way round, it's still by the columns chosen
    await user.click(within(dialog).getByRole('switch', { name: 'Amounts are the other way round' }));
    expect(
      within(dialog).getByText('2 transactions, Nov 1, 2026 to Nov 2, 2026. 1 out (-$4.50), 1 in (+$54.20).')
    ).toBeInTheDocument();
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

describe('without TaskMint', () => {
  it('is a bill tracker: TaskMint shows nowhere but a way to connect it', async () => {
    const { user } = await startBudget({ taskmint: false, items: [monthly('rent', 'Rent', 12, 50_000)] });
    expect(screen.queryByText('Next TaskMint withdrawal')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Income' }));
    expect(screen.getByText('Paychecks and other money coming in.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(screen.getByText('Bills and income, with the balance each day ends on.')).toBeInTheDocument();
    expect(screen.queryByText('TaskMint withdrawal')).not.toBeInTheDocument();
    expect(screen.queryByText(/includes time tracked in TaskMint/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Forecast' }));
    expect(screen.queryByText(/TaskMint/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reports' }));
    expect(screen.queryByText('From TaskMint')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'TaskMint' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const taskmint = section('TaskMint');
    expect(within(taskmint).getByText(/Use TaskMint\? Connect it/)).toBeInTheDocument();
    expect(within(taskmint).queryByLabelText('You withdraw')).not.toBeInTheDocument();
  });

  it('leaves TaskMint out of onboarding', async () => {
    await startBudget({ taskmint: false, settings: null });
    expect(
      await screen.findByText('A few things, and you’re set: what your bank account holds, your pay, and your bills.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Count TaskMint’s withdrawals' })).not.toBeInTheDocument();
  });
});

describe('a browser that hasn’t allowed notifications', () => {
  const NOTICE = 'Reminders are on, but this browser hasn’t allowed BudgetMint’s notifications.';
  const QUIET = 'This browser hasn’t allowed BudgetMint’s notifications.';
  const reminded = monthly('rent', 'Rent', 12, 50_000, { reminder: { leadDays: [3] } });
  /** A browser, asked: it says `answers` in turn, then the last again. */
  function browser(...answers: boolean[]) {
    const shell = createFakeShell({ runtime: 'web', without: ['tray', 'autostart'] });
    const granted = vi.fn(async () => (answers.length > 1 ? answers.shift()! : answers[0]));
    shell.platform.notifications.granted = granted;
    return { shell, granted };
  }

  it('says so in a toast once per account on this device, and quietly in Settings from then on', async () => {
    const { shell, granted } = browser(false);
    const first = await startBudget({ shell, items: [reminded] });
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    first.unmount();

    // Opened again: no toast, but Settings still says, with the way to allow them
    granted.mockClear();
    const { user } = await startBudget({ shell, items: [reminded] });
    await waitFor(() => expect(granted).toHaveBeenCalled());
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const reminders = section('Reminders');
    expect(await within(reminders).findByText(QUIET)).toBeInTheDocument();
    // Refused: said, and the line stays
    vi.mocked(shell.platform.notifications.request).mockResolvedValueOnce(false);
    await user.click(within(reminders).getByRole('button', { name: 'Allow' }));
    expect(await within(reminders).findByText(/Notifications are turned off for BudgetMint/)).toBeInTheDocument();
    expect(within(reminders).getByText(QUIET)).toBeInTheDocument();
    // Allowed: both gone
    await user.click(within(reminders).getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(within(reminders).queryByText(QUIET)).not.toBeInTheDocument());
    expect(within(reminders).queryByText(/Notifications are turned off/)).not.toBeInTheDocument();
    expect(shell.platform.notifications.request).toHaveBeenCalledTimes(2);
    // Reminders off on this device: nothing to allow
    await user.click(within(reminders).getByRole('switch', { name: 'Remind me on this device' }));
    expect(within(reminders).queryByText(QUIET)).not.toBeInTheDocument();
    // Kept for this account alone: another on this device is told once too
    expect(readLocal(notificationsNoticedKey('cal'), false)).toBe(true);
    expect(readLocal(notificationsNoticedKey('dee'), false)).toBe(false);
  });

  it('has no line in Settings where notifications are allowed, where the app can’t tell, or on the desktop', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const allowed = browser(true);
    const first = await startBudget({ shell: allowed.shell });
    await first.user.click(screen.getByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(allowed.granted).toHaveBeenCalled());
    expect(screen.queryByText(QUIET)).not.toBeInTheDocument();
    first.unmount();

    const silent = browser(false);
    silent.granted.mockRejectedValue(new Error('no answer'));
    const second = await startBudget({ shell: silent.shell });
    await second.user.click(screen.getByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(warn).toHaveBeenCalledWith('Failed to ask about notifications:', expect.any(Error)));
    expect(screen.queryByText(QUIET)).not.toBeInTheDocument();
    second.unmount();

    const { user } = await startBudget();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('They come while BudgetMint is open (or in the tray).')).toBeInTheDocument();
    expect(screen.queryByText(QUIET)).not.toBeInTheDocument();
    warn.mockRestore();
  });
});
