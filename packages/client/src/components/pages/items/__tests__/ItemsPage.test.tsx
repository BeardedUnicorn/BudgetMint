import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { item, monthly, override, SETTLED, startBudget } from '../../../../__tests__/setup/budget';

const docOf = (store: { docs: Map<string, { json: string }> }, id: string) =>
  JSON.parse(store.docs.get(`item~${id}`)!.json);

/** Opens a page from the sidebar. */
async function open(user: ReturnType<typeof import('@testing-library/user-event').default.setup>, page: string) {
  await user.click(screen.getByRole('button', { name: page }));
}

/** Closes a menu that stays open as its options are picked (a multiple choice). */
async function closeMenu() {
  // On the menu itself: the option clicked last may have taken the focus elsewhere
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
}

describe('bills and income', () => {
  it('lists bills with their schedule, next date and monthly cost', async () => {
    const { user } = await startBudget({
      items: [
        monthly('rent', 'Rent', 1, 120_000, { category: 'Home', autopay: true }),
        monthly('phone', 'Phone', 31, 6_000),
        item({
          id: 'pay',
          kind: 'income',
          name: 'Paycheck',
          autopay: true,
          schedule: [
            {
              from: '2026-11-13',
              until: null,
              repeat: { every: 'weeks', n: 2 },
              amountCents: 80_000,
              weekends: 'keep',
            },
          ],
        }),
      ],
    });
    await open(user, 'Bills');
    expect(screen.getByText('What goes out, and when. About $1,260.00 a month.')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Phone$60.00Monthly on the last dayMon, Nov 30$60.00');
    expect(rows[2]).toHaveTextContent('RentHomeAutopay$1,200.00Monthly on the 1st');
    expect(screen.queryByText('Paycheck')).not.toBeInTheDocument();
    await open(user, 'Income');
    // Income that comes in on its own isn't "autopay"
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('PaycheckAutomatic$800.00');
    expect(screen.getByText('Every 2 weeks on Friday')).toBeInTheDocument();
    expect(screen.getByText('Fri, Nov 13')).toBeInTheDocument();
  });

  it('adds income, saying what to fix first', async () => {
    const { user, store } = await startBudget();
    await open(user, 'Income');
    expect(screen.getByText('No income yet')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Add income' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Add income' });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Enter the amount')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Amount')).toBeInvalid();
    expect(within(dialog).getByLabelText('Amount')).toHaveFocus();
    await user.type(within(dialog).getByLabelText('Amount'), '800');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Give it a name')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Name'), 'Side job');
    // Every 2 weeks, from the 13th
    await user.click(within(dialog).getByLabelText('Repeats'));
    await user.click(screen.getByRole('option', { name: 'Every… weeks' }));
    const every = within(dialog).getByLabelText('Every how many weeks');
    await user.clear(every);
    await user.type(every, '2');
    fireEvent.change(within(dialog).getByLabelText('First on'), { target: { value: '2026-11-13' } });
    await user.type(within(dialog).getByLabelText('Category (optional)'), 'Work');
    await user.click(within(dialog).getByRole('switch', { name: 'Comes in automatically' }));
    // Income doesn't remind unless asked to
    expect(within(dialog).getByRole('switch', { name: 'Remind me' })).not.toBeChecked();
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Fridays');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const saved = Object.values(Object.fromEntries(store.docs))
      .map(doc => JSON.parse(doc.json))
      .find(doc => doc.name === 'Side job');
    expect(saved).toMatchObject({
      kind: 'income',
      category: 'Work',
      autopay: true,
      reminder: null,
      note: 'Fridays',
      schedule: [{ from: '2026-11-13', repeat: { every: 'weeks', n: 2 }, amountCents: 80_000, weekends: 'keep' }],
    });
  });

  it('adds a monthly bill on a day, or once, with a reminder', async () => {
    const { user, store } = await startBudget({
      settings: { balance: { cents: 1, asOf: '2026-11-09' }, reminders: { leadDays: 5 } },
    });
    await open(user, 'Bills');
    await user.click(screen.getAllByRole('button', { name: 'Add bill' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Add bill' });
    await user.type(within(dialog).getByLabelText('Name'), 'Insurance');
    await user.type(within(dialog).getByLabelText('Amount'), '90');
    await user.click(within(dialog).getByLabelText('On day'));
    await user.click(screen.getByRole('option', { name: 'The last day' }));
    // Bills remind by default, as Settings say (5 days); 2 days instead
    expect(within(dialog).getByLabelText('When')).toHaveTextContent('5 days before');
    await user.click(within(dialog).getByLabelText('When'));
    await user.click(screen.getByRole('option', { name: '5 days before' }));
    await user.click(screen.getByRole('option', { name: '2 days before' }));
    await closeMenu();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const docs = [...store.docs.values()].map(doc => JSON.parse(doc.json));
    expect(docs.find(doc => doc.name === 'Insurance')).toMatchObject({
      reminder: { leadDays: [2] },
      schedule: [{ repeat: { every: 'months', n: 1, day: 31 }, amountCents: 9_000, weekends: 'keep' }],
    });

    await user.click(screen.getAllByRole('button', { name: 'Add bill' })[0]);
    const once = screen.getByRole('dialog', { name: 'Add bill' });
    await user.type(within(once).getByLabelText('Name'), 'Repair');
    await user.type(within(once).getByLabelText('Amount'), '45');
    await user.click(within(once).getByLabelText('Repeats'));
    await user.click(screen.getByRole('option', { name: 'Once' }));
    expect(within(once).queryByLabelText(/Every how many/)).not.toBeInTheDocument();
    expect(within(once).getByLabelText('On')).toBeInTheDocument();
    await user.click(within(once).getByRole('switch', { name: 'Remind me' }));
    await user.click(within(once).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect([...store.docs.values()].map(doc => JSON.parse(doc.json)).find(doc => doc.name === 'Repair')).toMatchObject({
      reminder: null,
      schedule: [{ repeat: { every: 'once' } }],
    });
  });

  it('edits a bill: from a date once it has started, the whole schedule before', async () => {
    const future = item({
      id: 'gym',
      kind: 'bill',
      name: 'Gym',
      schedule: [
        {
          from: '2026-12-05',
          until: null,
          repeat: { every: 'months', n: 1, day: 5 },
          amountCents: 3_000,
          weekends: 'keep',
        },
      ],
      reminder: { leadDays: [1] },
    });
    const { user, store } = await startBudget({ items: [monthly('rent', 'Rent', 1, 120_000), future] });
    await open(user, 'Bills');
    // Renamed only: the schedule stays
    await user.click(screen.getByRole('button', { name: 'Edit Rent' }));
    let dialog = screen.getByRole('dialog', { name: 'Edit Rent' });
    expect(within(dialog).queryByLabelText('First on')).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Name'), ' (flat)');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(docOf(store, 'rent').name).toBe('Rent (flat)'));
    expect(docOf(store, 'rent').schedule).toHaveLength(1);

    // More from January: a new part of the schedule
    await user.click(screen.getByRole('button', { name: 'Edit Rent (flat)' }));
    dialog = screen.getByRole('dialog', { name: 'Edit Rent (flat)' });
    const amount = within(dialog).getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '1300');
    fireEvent.change(within(dialog).getByLabelText('The change starts on'), { target: { value: '2027-01-01' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(docOf(store, 'rent').schedule).toHaveLength(2));
    expect(docOf(store, 'rent').schedule[1]).toMatchObject({ from: '2027-01-01', amountCents: 130_000 });

    // Not started: its schedule replaced, from a new first date
    await user.click(screen.getByRole('button', { name: 'Edit Gym' }));
    dialog = screen.getByRole('dialog', { name: 'Edit Gym' });
    expect(within(dialog).getByRole('switch', { name: 'Remind me' })).toBeChecked();
    await user.click(within(dialog).getByLabelText('Repeats'));
    await user.click(screen.getByRole('option', { name: 'Every… days' }));
    fireEvent.change(within(dialog).getByLabelText('First on'), { target: { value: '2026-12-07' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(docOf(store, 'gym').schedule).toEqual([
        { from: '2026-12-07', until: null, repeat: { every: 'days', n: 1 }, amountCents: 3_000, weekends: 'keep' },
      ])
    );
  });

  it('ends a bill on a date, from a change too, and goes on again', async () => {
    const { user, store } = await startBudget({ items: [monthly('rent', 'Rent', 1, 120_000)] });
    await open(user, 'Bills');
    await user.click(screen.getByRole('button', { name: 'Edit Rent' }));
    let dialog = screen.getByRole('dialog', { name: 'Edit Rent' });
    await user.click(within(dialog).getByRole('switch', { name: 'Ends' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Choose the date it ends on')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Last on or before')).toHaveFocus();
    fireEvent.change(within(dialog).getByLabelText('Last on or before'), { target: { value: '2027-06-30' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(docOf(store, 'rent').schedule[0].until).toBe('2027-06-30'));
    expect(screen.getByText('Monthly on the 1st, until Jun 30, 2027')).toBeInTheDocument();

    // A new amount from January, ending later
    await user.click(screen.getByRole('button', { name: 'Edit Rent' }));
    dialog = screen.getByRole('dialog', { name: 'Edit Rent' });
    expect(within(dialog).getByLabelText('Last on or before')).toHaveValue('2027-06-30');
    const amount = within(dialog).getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '1300');
    fireEvent.change(within(dialog).getByLabelText('The change starts on'), { target: { value: '2027-01-01' } });
    fireEvent.change(within(dialog).getByLabelText('Last on or before'), { target: { value: '2027-12-31' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(docOf(store, 'rent').schedule).toHaveLength(2));
    expect(docOf(store, 'rent').schedule[1]).toMatchObject({ from: '2027-01-01', until: '2027-12-31' });

    // Going on again: its last part's end goes
    await user.click(screen.getByRole('button', { name: 'Edit Rent' }));
    dialog = screen.getByRole('dialog', { name: 'Edit Rent' });
    await user.click(within(dialog).getByRole('switch', { name: 'Ends' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(docOf(store, 'rent').schedule[1].until).toBeNull());
  });

  it('finds a bill by name or category, in another order, and sums each category', async () => {
    const { user } = await startBudget({
      items: [
        monthly('rent', 'Rent', 1, 120_000, { category: 'Home' }),
        monthly('power', 'Power', 20, 9_000, { category: 'Home' }),
        // Its amount varies, and last came to $150: that's what it's sorted and summed by
        monthly('phone', 'Phone', 31, 6_000, { category: 'Utilities', note: 'Family plan', varies: true }),
        monthly('gym', 'Gym', 5, 3_000),
        monthly('old', 'Old lease', 3, 100_000, { category: 'Home', archived: true }),
      ],
      overrides: [
        override({
          itemId: 'phone',
          date: '2026-10-31',
          status: { state: 'done', on: '2026-10-31', amountCents: 15_000 },
        }),
      ],
    });
    await open(user, 'Bills');
    expect(screen.getByLabelText('A month, by category')).toHaveTextContent(
      'A month by category: Home $1,290.00 · Utilities $150.00 · No category $30.00'
    );
    expect(screen.getByText('Family plan')).toBeInTheDocument();
    const names = () =>
      screen
        .getAllByRole('row')
        .filter(row => row.querySelector('td'))
        .map(row => row.querySelector('p')!.textContent);
    expect(names()).toEqual(['Power', 'Phone', 'Rent', 'Gym', 'Old lease']);

    // By a word of the name or the category, the archived ones too
    await user.type(screen.getByLabelText('Search'), 'home');
    expect(names()).toEqual(['Power', 'Rent', 'Old lease']);
    expect(screen.queryByLabelText('A month, by category')).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search'));
    await user.click(screen.getByLabelText('Category'));
    await user.click(screen.getByRole('option', { name: 'Utilities' }));
    expect(names()).toEqual(['Phone']);
    await user.click(screen.getByLabelText('Category'));
    await user.click(screen.getByRole('option', { name: 'Every category' }));

    for (const [order, expected] of [
      ['Amount', ['Rent', 'Phone', 'Power', 'Gym', 'Old lease']],
      ['A month', ['Rent', 'Phone', 'Power', 'Gym', 'Old lease']],
      ['Name', ['Gym', 'Phone', 'Power', 'Rent', 'Old lease']],
    ] as const) {
      await user.click(screen.getByLabelText('Order'));
      await user.click(screen.getByRole('option', { name: order }));
      expect(names()).toEqual(expected);
    }
    await user.type(screen.getByLabelText('Search'), 'nothing like it');
    expect(screen.getByText('No bills match.')).toBeInTheDocument();
  });

  it('offers the categories in use, and drops a filter for one no longer used', async () => {
    const { user, store } = await startBudget({
      items: [monthly('rent', 'Rent', 1, 120_000, { category: 'Home' }), monthly('gym', 'Gym', 5, 3_000)],
    });
    await open(user, 'Bills');
    await user.click(screen.getByRole('button', { name: 'Add bill' }));
    const dialog = screen.getByRole('dialog', { name: 'Add bill' });
    await user.type(within(dialog).getByLabelText('Category (optional)'), 'Ho');
    await user.click(await screen.findByRole('option', { name: 'Home' }));
    expect(within(dialog).getByLabelText('Category (optional)')).toHaveValue('Home');
    await user.keyboard('{Escape}');
    // Something's typed: Escape asks before throwing it away
    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByLabelText('Category'));
    await user.click(screen.getByRole('option', { name: 'Home' }));
    expect(screen.queryByText('Gym')).not.toBeInTheDocument();
    // Its last bill moved to another category elsewhere: everything shows again
    store.putDoc('item~rent', JSON.stringify({ ...docOf(store, 'rent'), category: 'Flat' }));
    expect(await screen.findByText('Gym')).toBeInTheDocument();
  });

  it('puts each row’s actions in a menu by its name on a phone', async () => {
    const { setPhoneViewport } = await import('../../../../__tests__/setup/viewport');
    setPhoneViewport();
    const { user, store } = await startBudget({
      items: [monthly('rent', 'Rent', 1, 120_000), monthly('old', 'Old', 3, 1_000, { archived: true })],
    });
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    await user.click(await screen.findByRole('button', { name: 'Bills' }));
    expect(await screen.findByRole('heading', { name: 'Bills' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Rent' })).not.toBeInTheDocument();
    // Opened, and closed again without a choice
    await user.click(screen.getByRole('button', { name: 'Rent: what to do' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Rent: what to do' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive Rent' }));
    await waitFor(() => expect(docOf(store, 'rent').archived).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Old: what to do' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit Old' }));
    expect(screen.getByRole('dialog', { name: 'Edit Old' })).toBeInTheDocument();
  });

  it('saves a rename and a new amount together, or neither, and undoes both', async () => {
    const { user, store } = await startBudget({ items: [monthly('rent', 'Rent', 1, 120_000)] });
    await open(user, 'Bills');
    await user.click(screen.getByRole('button', { name: 'Edit Rent' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Rent' });
    await user.type(within(dialog).getByLabelText('Name'), ' (flat)');
    const amount = within(dialog).getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '1300');
    // Without the date the change starts on, nothing is saved: not the name either
    fireEvent.change(within(dialog).getByLabelText('The change starts on'), { target: { value: '' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Choose the date the change starts on')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('The change starts on')).toBeInvalid();
    expect(docOf(store, 'rent').name).toBe('Rent');

    fireEvent.change(within(dialog).getByLabelText('The change starts on'), { target: { value: '2027-01-01' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Rent (flat) saved')).toBeInTheDocument();
    await waitFor(() => expect(docOf(store, 'rent').schedule).toHaveLength(2));
    expect(docOf(store, 'rent').name).toBe('Rent (flat)');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(docOf(store, 'rent').name).toBe('Rent'));
    expect(docOf(store, 'rent').schedule).toHaveLength(1);
  });

  it('reminds up to three times before, and keeps the days as they were', async () => {
    const rent = monthly('rent', 'Rent', 1, 120_000, { reminder: { leadDays: [4, 10] }, note: 'Landlord: Pat' });
    const { user, store } = await startBudget({ items: [rent], settings: { ...SETTLED, reminders: { leadDays: 6 } } });
    await open(user, 'Bills');
    await user.click(screen.getByRole('button', { name: 'Edit Rent' }));
    let dialog = screen.getByRole('dialog', { name: 'Edit Rent' });
    // Not among the usual choices, and still shown
    expect(within(dialog).getByLabelText('When')).toHaveTextContent('4 days before, 10 days before');
    await user.type(within(dialog).getByLabelText('Name'), '!');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(docOf(store, 'rent').name).toBe('Rent!'));
    expect(docOf(store, 'rent').reminder).toEqual({ leadDays: [4, 10] });

    await user.click(screen.getByRole('button', { name: 'Edit Rent!' }));
    dialog = screen.getByRole('dialog', { name: 'Edit Rent!' });
    await user.click(within(dialog).getByLabelText('When'));
    await user.click(screen.getByRole('option', { name: '1 day before' }));
    // Three chosen: no more
    expect(screen.getByRole('option', { name: 'On the day' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('option', { name: '4 days before' }));
    await user.click(screen.getByRole('option', { name: '10 days before' }));
    await closeMenu();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(docOf(store, 'rent').reminder).toEqual({ leadDays: [1] }));

    // None chosen: no reminder
    await user.click(screen.getByRole('button', { name: 'Edit Rent!' }));
    dialog = screen.getByRole('dialog', { name: 'Edit Rent!' });
    await user.click(within(dialog).getByLabelText('When'));
    await user.click(screen.getByRole('option', { name: '1 day before' }));
    await closeMenu();
    expect(within(dialog).getByLabelText('When')).toHaveTextContent('Choose when');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(docOf(store, 'rent').reminder).toBeNull());

    // The item's note heads its history
    await user.click(screen.getByRole('button', { name: "Rent!'s history" }));
    expect(within(screen.getByRole('dialog', { name: 'Rent!' })).getByText('Landlord: Pat')).toBeInTheDocument();
    // The settings' own choice shows too
    await user.keyboard('{Escape}');
    await open(user, 'Settings');
    expect(screen.getByLabelText('New bills remind')).toHaveTextContent('6 days before');
  });

  it('writes nothing when an edit changes nothing, and closes on Escape', async () => {
    const { user, store } = await startBudget({ items: [monthly('rent', 'Rent', 1, 120_000)] });
    await open(user, 'Bills');
    await user.click(screen.getByRole('button', { name: 'Edit Rent' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Edit Rent' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('Rent saved')).not.toBeInTheDocument();
    expect(store.writes).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Edit Rent' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('says the weekly change repeats on its day of the week', async () => {
    const weekly = item({
      id: 'lunch',
      kind: 'bill',
      name: 'Lunch',
      schedule: [
        { from: '2026-10-02', until: null, repeat: { every: 'weeks', n: 1 }, amountCents: 1_000, weekends: 'keep' },
      ],
    });
    const { user } = await startBudget({ items: [weekly] });
    await open(user, 'Bills');
    await user.click(screen.getByRole('button', { name: 'Edit Lunch' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Lunch' });
    const every = within(dialog).getByLabelText('Every how many weeks');
    await user.clear(every);
    await user.type(every, '2');
    expect(within(dialog).getByText(/It repeats on that day of the week/)).toBeInTheDocument();
    // A change the rules refuse
    fireEvent.change(within(dialog).getByLabelText('Every how many weeks'), { target: { value: '99' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText(/Choose how often it repeats/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  });

  it('archives, brings back and deletes a bill', async () => {
    const { user, store } = await startBudget({
      items: [monthly('rent', 'Rent', 1, 120_000)],
      overrides: [
        override({
          itemId: 'rent',
          date: '2026-11-01',
          status: { state: 'done', on: '2026-11-01', amountCents: 120_000 },
        }),
      ],
    });
    await open(user, 'Bills');
    await user.click(screen.getByRole('button', { name: 'Archive Rent' }));
    expect(await screen.findByText('Rent archived')).toBeInTheDocument();
    expect(screen.getByText('All archived.')).toBeInTheDocument();
    const archived = screen.getByRole('region', { name: 'Archived' });
    await user.click(within(archived).getByRole('button', { name: 'Bring back Rent' }));
    expect(await screen.findByText('Rent back')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archive Rent' }));
    await user.click(await screen.findByRole('button', { name: 'Delete Rent' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete Rent?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(store.docs.has('item~rent')).toBe(false));
    expect(store.docs.has('occ~2026-11-01~rent')).toBe(false);
    expect(await screen.findByText('No bills yet')).toBeInTheDocument();
  });

  it('shows a bill’s history, and changes one of its occurrences there', async () => {
    const { user, store } = await startBudget({
      items: [
        monthly('rent', 'Rent', 1, 120_000),
        monthly('new', 'New', 1, 1, {
          schedule: [{ from: '2030-01-01', until: null, repeat: { every: 'once' }, amountCents: 1, weekends: 'keep' }],
        }),
      ],
      overrides: [
        override({
          itemId: 'rent',
          date: '2026-11-01',
          status: { state: 'done', on: '2026-11-02', amountCents: 119_000 },
        }),
      ],
    });
    await open(user, 'Bills');
    await user.click(screen.getByRole('button', { name: "New's history" }));
    expect(screen.getByText('Nothing in the past year or the next three months.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: "Rent's history" }));
    const history = screen.getByRole('dialog', { name: 'Rent' });
    expect(within(history).getByText('Paid')).toBeInTheDocument();
    expect(within(history).getByText('−$1,190.00')).toBeInTheDocument();
    await user.click(within(history).getByRole('button', { name: 'Rent on Dec 1: details' }));
    const occurrence = screen.getByRole('dialog', { name: 'Rent, Dec 1' });
    await user.click(within(occurrence).getByRole('radio', { name: 'Not this time (skip it)' }));
    await user.click(within(occurrence).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(JSON.parse(store.docs.get('occ~2026-12-01~rent')!.json).status).toEqual({ state: 'skipped' })
    );
    expect(within(history).getByText('Skipped')).toBeInTheDocument();
  });
});
