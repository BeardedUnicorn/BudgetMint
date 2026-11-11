import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { forecastDoc, item, monthly, override, startBudget, TEST_NOW } from '../../../../__tests__/setup/budget';

const PAY = item({
  id: 'pay',
  kind: 'income',
  name: 'Paycheck',
  schedule: [{ from: '2026-11-13', until: null, repeat: { every: 'weeks', n: 2 }, amountCents: 80_000 }],
});

describe('the overview', () => {
  it('says where the balance goes: today, this week, coming in, the lowest', async () => {
    await startBudget({ items: [monthly('rent', 'Rent', 12, 50_000), PAY] });
    expect(screen.getByText('From your balance of $1,000.00 at the end of Nov 9')).toBeInTheDocument();
    const today = screen.getByRole('region', { name: 'Balance today' });
    expect(within(today).getByText('$1,000.00')).toBeInTheDocument();
    expect(within(today).getByText('Lowest in the next 60 days: $500.00 on Thu, Nov 12')).toBeInTheDocument();
    expect(screen.getByText('Due this week').parentElement).toHaveTextContent('$500.00Due this week1 bill');
    expect(screen.getByText('Coming in').parentElement).toHaveTextContent('$800.00');
    expect(screen.getByText('TaskMint isn’t connected')).toBeInTheDocument();
    const upcoming = screen.getByRole('region', { name: 'The next 14 days' });
    expect(within(upcoming).getByRole('heading', { name: 'Thu, Nov 12' })).toBeInTheDocument();
    expect(within(upcoming).getByText('Balance $500.00')).toBeInTheDocument();
    expect(within(upcoming).getByText('+$800.00')).toBeInTheDocument();
  });

  it('warns before the balance goes short or low', async () => {
    const { store } = await startBudget({ items: [monthly('rent', 'Rent', 12, 150_000)] });
    expect(screen.getByText('Your balance goes below zero on Thu, Nov 12, to -$500.00.')).toBeInTheDocument();
    expect(screen.getByText('Lowest ahead').parentElement).toHaveTextContent('-$2,000.00');

    store.putDoc('item~rent', JSON.stringify(monthly('rent', 'Rent', 12, 95_000)));
    store.putDoc(
      'settings~account',
      // 30 days: the next rent (Dec 12, short) is past it
      JSON.stringify({ balance: { cents: 100_000, asOf: '2026-11-09' }, lowBalanceCents: 10_000, horizonDays: 30 })
    );
    expect(await screen.findByText('Your balance goes below $100.00 on Thu, Nov 12, to $50.00.')).toBeInTheDocument();
  });

  it('keeps a bill’s moved date and its own amount when it’s marked paid', async () => {
    // The 20th's water, moved to the 12th, for $35 this time
    const { user, store } = await startBudget({
      items: [monthly('water', 'Water', 20, 3_000)],
      overrides: [
        override({
          itemId: 'water',
          date: '2026-11-20',
          status: { state: 'open' },
          movedTo: '2026-11-12',
          amountCents: 3_500,
          note: 'Asked to pay early',
        }),
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Mark Water paid' }));
    expect(await screen.findByText('Water marked paid')).toBeInTheDocument();
    expect(JSON.parse(store.docs.get('occ~2026-11-20~water')!.json)).toMatchObject({
      status: { state: 'done', on: '2026-11-10', amountCents: 3_500 },
      movedTo: '2026-11-12',
      amountCents: 3_500,
      note: 'Asked to pay early',
    });
  });

  it('marks an overdue bill paid, and undoes it', async () => {
    // Due on the 9th, after the balance's day, and not paid: overdue
    const { user, store } = await startBudget({
      items: [monthly('water', 'Water', 9, 3_000)],
      settings: { balance: { cents: 100_000, asOf: '2026-11-08' } },
    });
    const section = screen.getByRole('region', { name: 'Past due' });
    expect(within(section).getByText('Overdue')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Mark Water paid' }));
    expect(await screen.findByText('Water marked paid')).toBeInTheDocument();
    expect(JSON.parse(store.docs.get('occ~2026-11-09~water')!.json).status).toEqual({
      state: 'done',
      on: '2026-11-10',
      amountCents: 3_000,
    });
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.docs.has('occ~2026-11-09~water')).toBe(false));
  });

  it('shows TaskMint’s next withdrawal, open now or later', async () => {
    await startBudget({ forecast: forecastDoc({ asOfMs: TEST_NOW, carried: { actualCents: 4_000 } }) });
    expect(screen.getByText('Next TaskMint withdrawal').parentElement).toHaveTextContent('$40.00');
    expect(screen.getByText('Open now, in the bank Nov 11')).toBeInTheDocument();
  });

  it('says when a TaskMint withdrawal is later, or there’s nothing to take', async () => {
    const later = forecastDoc({
      asOfMs: TEST_NOW,
      cutoff: { takenAtMs: TEST_NOW - 86_400_000, amountCents: 1 },
      steps: [{ atMs: TEST_NOW + 86_400_000, actualCents: 0, estimatedCents: 700, pastDueCents: 0 }],
    });
    const { store } = await startBudget({ forecast: later });
    expect(screen.getByText('Next TaskMint withdrawal').parentElement).toHaveTextContent('~$7.00');
    expect(screen.getByText('Fri, Nov 13, in the bank')).toBeInTheDocument();
    store.publishForecast(forecastDoc({ asOfMs: TEST_NOW }));
    expect(await screen.findByText('Nothing to withdraw yet')).toBeInTheDocument();
  });

  it('says why TaskMint’s withdrawals aren’t there, and when its logs are old', async () => {
    const { store } = await startBudget();
    expect(screen.getByText('TaskMint isn’t connected')).toBeInTheDocument();
    store.publishForecast({ ...forecastDoc({ asOfMs: TEST_NOW }), schema: 2 });
    expect(await screen.findByText('Update BudgetMint to read TaskMint')).toBeInTheDocument();
    store.publishForecast({ ...forecastDoc({ asOfMs: TEST_NOW }), json: '{' });
    expect(await screen.findByText('TaskMint’s forecast can’t be read')).toBeInTheDocument();
    // Imported more than three days ago: its numbers may be old
    store.publishForecast(forecastDoc({ asOfMs: TEST_NOW, lastImportMs: TEST_NOW - 4 * 86_400_000 }));
    expect(
      await screen.findByText(/work logs were last imported .*: its withdrawals may be out of date/)
    ).toBeInTheDocument();
  });

  it('asks for a balance, and takes it', async () => {
    const { user, store } = await startBudget({ settings: { horizonDays: 30 } });
    expect(screen.getByText('Until you set your balance, the forecast starts from $0.')).toBeInTheDocument();
    expect(screen.getByText('No bills yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set balance' }));
    const dialog = screen.getByRole('dialog', { name: 'Your balance' });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText(/Enter what the account holds/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Balance')).toBeInvalid();
    expect(within(dialog).getByLabelText('Balance')).toHaveFocus();
    await user.type(within(dialog).getByLabelText('Balance'), '-25.50');
    fireEvent.change(within(dialog).getByLabelText('As of the end of'), { target: { value: '2030-01-01' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Set the balance as of today or a day before')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('As of the end of'), { target: { value: '2026-11-10' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(JSON.parse(store.docs.get('settings~account')!.json).balance).toEqual({ cents: -2_550, asOf: '2026-11-10' });
    expect(await screen.findByText('Your balance goes below zero on Tue, Nov 10, to -$25.50.')).toBeInTheDocument();
  });

  it('adds a bill, and opens the calendar', async () => {
    const { user, store } = await startBudget({ items: [monthly('rent', 'Rent', 1, 50_000)] });
    expect(screen.getByText('Nothing due or coming in.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add bill' }));
    const dialog = screen.getByRole('dialog', { name: 'Add bill' });
    await user.type(within(dialog).getByLabelText('Name'), 'Gym');
    await user.type(within(dialog).getByLabelText('Amount'), '30');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect([...store.docs.keys()].filter(key => key.startsWith('item~'))).toHaveLength(2));
    const upcoming = screen.getByRole('region', { name: 'The next 14 days' });
    await user.click(within(upcoming).getByRole('button', { name: 'Calendar' }));
    expect(screen.getByRole('heading', { name: 'Calendar', level: 1 })).toBeInTheDocument();
  });

  it('lists income that’s late, and occurrences moved or with a note', async () => {
    const late = item({
      id: 'refund',
      kind: 'income',
      name: 'Refund',
      schedule: [{ from: '2026-11-09', until: null, repeat: { every: 'once' }, amountCents: 2_000 }],
    });
    await startBudget({
      items: [late, monthly('rent', 'Rent', 1, 50_000)],
      settings: { balance: { cents: 100_000, asOf: '2026-11-08' } },
      overrides: [
        override({
          itemId: 'rent',
          date: '2026-12-01',
          status: { state: 'open' },
          movedTo: '2026-11-20',
          note: 'Early this time',
        }),
      ],
    });
    const section = screen.getByRole('region', { name: 'Past due' });
    expect(within(section).getByText('Late')).toBeInTheDocument();
    expect(screen.getByText('Moved from Dec 1 · Early this time')).toBeInTheDocument();
  });
});
