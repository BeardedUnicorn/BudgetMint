import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { forecastDoc, item, monthly, override, startBudget, TEST_NOW } from '../../../../__tests__/setup/budget';

const PAY = item({
  id: 'pay',
  kind: 'income',
  name: 'Paycheck',
  schedule: [
    { from: '2026-11-13', until: null, repeat: { every: 'weeks', n: 2 }, amountCents: 80_000, weekends: 'keep' },
  ],
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
    expect(screen.getByText(/^Lowest in the next 60 days:/)).toHaveTextContent('-$2,000.00');

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
    const section = screen.getByRole('region', { name: 'Overdue and late' });
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
    expect(within(dialog).getByText(/Enter what the bank account holds/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Balance')).toBeInvalid();
    expect(within(dialog).getByLabelText('Balance')).toHaveFocus();
    await user.type(within(dialog).getByLabelText('Balance'), '-25.50');
    fireEvent.change(within(dialog).getByLabelText('As of'), { target: { value: '2030-01-01' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Set the balance as of today or a day before')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('As of'), { target: { value: '2026-11-10' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(JSON.parse(store.docs.get('settings~account')!.json).balance).toEqual({ cents: -2_550, asOf: '2026-11-10' });
    expect(await screen.findByText('Your balance goes below zero on Tue, Nov 10, to -$25.50.')).toBeInTheDocument();
  });

  it('adds a bill, and opens the calendar', async () => {
    const { user, store } = await startBudget({ items: [monthly('rent', 'Rent', 1, 50_000)] });
    expect(screen.getByText('Nothing due or coming in.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('menuitem', { name: 'A bill' }));
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
      schedule: [{ from: '2026-11-09', until: null, repeat: { every: 'once' }, amountCents: 2_000, weekends: 'keep' }],
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
    const section = screen.getByRole('region', { name: 'Overdue and late' });
    expect(within(section).getByText('Late')).toBeInTheDocument();
    expect(screen.getByText('Moved from Dec 1 · Early this time')).toBeInTheDocument();
  });

  it('records a one-off spend or income from Add, saying what to fix under its field', async () => {
    const { user, store } = await startBudget({ items: [monthly('rent', 'Rent', 1, 50_000)] });
    const recorded = () =>
      [...store.docs.values()]
        .map(doc => JSON.parse(doc.json))
        .filter(doc => doc.schedule?.[0].repeat.every === 'once');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('menuitem', { name: 'A one-off spend or income' }));
    let dialog = screen.getByRole('dialog', { name: 'Record a one-off' });
    expect(within(dialog).getByRole('button', { name: 'I spent' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByLabelText('Amount')).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Enter the amount')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Amount'), '600');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    // Core's refusals, under their fields
    expect(within(dialog).getByLabelText('On what')).toBeInvalid();
    await user.type(within(dialog).getByLabelText('On what'), 'Car repair');
    fireEvent.change(within(dialog).getByLabelText('When'), { target: { value: '1000-01-01' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByLabelText('When')).toBeInvalid();
    fireEvent.change(within(dialog).getByLabelText('When'), { target: { value: '2026-11-10' } });
    await user.type(within(dialog).getByLabelText('Category (optional)'), 'Car');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Car repair recorded')).toBeInTheDocument();
    // Paid today, as recorded
    const [repair] = recorded();
    expect(repair).toMatchObject({ kind: 'bill', name: 'Car repair', category: 'Car', reminder: null });
    expect(JSON.parse(store.docs.get(`occ~2026-11-10~${repair.id}`)!.json).status).toEqual({
      state: 'done',
      on: '2026-11-10',
      amountCents: 60_000,
    });

    // Income still to come
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('menuitem', { name: 'A one-off spend or income' }));
    dialog = screen.getByRole('dialog', { name: 'Record a one-off' });
    await user.click(within(dialog).getByRole('button', { name: 'I got' }));
    // Pressing the chosen one again keeps it
    await user.click(within(dialog).getByRole('button', { name: 'I got' }));
    await user.type(within(dialog).getByLabelText('Amount'), '45');
    await user.type(within(dialog).getByLabelText('From what'), 'Refund');
    fireEvent.change(within(dialog).getByLabelText('When'), { target: { value: '2026-11-20' } });
    expect(within(dialog).getByText('Still to come: it counts in the forecast')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(recorded()).toHaveLength(2));
    expect(recorded().find(doc => doc.name === 'Refund')).toMatchObject({ kind: 'income' });

    // A refusal that's about no field (the same one recorded twice) is said above
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue('1-1-1-1-1');
    for (const _ of [1, 2]) {
      await user.click(screen.getByRole('button', { name: 'Add' }));
      await user.click(screen.getByRole('menuitem', { name: 'A one-off spend or income' }));
      dialog = screen.getByRole('dialog', { name: 'Record a one-off' });
      await user.type(within(dialog).getByLabelText('Amount'), '5');
      await user.type(within(dialog).getByLabelText('On what'), 'Coffee');
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    }
    expect(await within(dialog).findByText('That’s recorded already'.replace('’', "'"))).toBeInTheDocument();
    uuid.mockRestore();
  });

  it('asks whether what’s paid on the balance’s own day is in the balance, and takes it off', async () => {
    // The balance was set today: what's paid today may have gone after it
    const { user, store } = await startBudget({
      settings: { balance: { cents: 100_000, asOf: '2026-11-10' } },
      items: [
        monthly('phone', 'Phone', 12, 6_000),
        monthly('power', 'Power', 10, 9_000, { autopay: true, varies: true }),
      ],
    });
    const balance = () => JSON.parse(store.docs.get('settings~account')!.json).balance.cents;

    // Mark paid asks, at its amount
    await user.click(screen.getByRole('button', { name: 'Mark Phone paid' }));
    let dialog = screen.getByRole('dialog', { name: 'Phone, Nov 12' });
    expect(within(dialog).getByLabelText('Paid')).toBeChecked();
    expect(within(dialog).getByLabelText('Amount')).toHaveValue('60.00');
    const take = within(dialog).getByRole('checkbox', { name: 'Take it off your balance: $1,000.00 → $940.00' });
    expect(take).toBeChecked();
    expect(within(dialog).getByText('Your balance is from the same day, Nov 10. Untick this if it counts it already.'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Phone saved, and taken off your balance')).toBeInTheDocument();
    expect(balance()).toBe(94_000);
    // One change: Undo puts both back
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(balance()).toBe(100_000));
    expect(store.docs.has('occ~2026-11-12~phone')).toBe(false);

    // Unticked: the balance has it already
    await user.click(screen.getByRole('button', { name: 'Mark Phone paid' }));
    dialog = screen.getByRole('dialog', { name: 'Phone, Nov 12' });
    await user.click(within(dialog).getByRole('checkbox', { name: /^Take it off your balance/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Phone saved')).toBeInTheDocument();
    expect(balance()).toBe(100_000);

    // On autopay it went by itself on its day: taken to be in the balance, unless ticked
    await user.click(screen.getAllByRole('button', { name: 'Enter what Power came to on Nov 10' })[0]);
    dialog = screen.getByRole('dialog', { name: 'Power, Nov 10' });
    expect(within(dialog).getByRole('checkbox', { name: /^Take it off your balance/ })).not.toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    // A one-off today too; one dated before the balance's day is taken to be in it
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('menuitem', { name: 'A one-off spend or income' }));
    dialog = screen.getByRole('dialog', { name: 'Record a one-off' });
    await user.click(within(dialog).getByRole('button', { name: 'I got' }));
    expect(within(dialog).getByRole('checkbox', { name: 'Add it to your balance: $1,000.00' })).toBeChecked();
    await user.type(within(dialog).getByLabelText('Amount'), '25');
    await user.type(within(dialog).getByLabelText('From what'), 'Refund');
    expect(within(dialog).getByRole('checkbox', { name: 'Add it to your balance: $1,000.00 → $1,025.00' }));
    fireEvent.change(within(dialog).getByLabelText('When'), { target: { value: '2026-11-08' } });
    const add = within(dialog).getByRole('checkbox', { name: /^Add it to your balance/ });
    expect(add).not.toBeChecked();
    expect(within(dialog).getByText('It’s before your balance’s day, Nov 10: the balance likely counts it already.'));
    await user.click(add);
    // Not a whole day while it's typed: nothing to ask
    fireEvent.change(within(dialog).getByLabelText('When'), { target: { value: '' } });
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('When'), { target: { value: '2026-11-08' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Refund recorded, and added to your balance')).toBeInTheDocument();
    expect(balance()).toBe(102_500);
  });

  it('adds income from Add, and says when everyday spending isn’t counted', async () => {
    // With nothing yet, income can be the first thing added
    const empty = await startBudget();
    await empty.user.click(screen.getByRole('button', { name: 'Add income' }));
    expect(screen.getByRole('dialog', { name: 'Add income' })).toBeInTheDocument();
    empty.unmount();

    const { user } = await startBudget({ items: [monthly('rent', 'Rent', 1, 50_000)] });
    // The menu closes without a choice too
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('menuitem', { name: 'Income' }));
    expect(screen.getByRole('dialog', { name: 'Add income' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText(/Everyday spending \(food, fuel\) isn’t counted yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set it' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });
});
