/**
 * Money moved between two bank accounts: scheduled like a bill or recorded
 * once, out of the one and into the other, marked moved like a bill is
 * marked paid, and never taken for income.
 */

import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { account, item, startBudget } from './setup/budget';
import { otherAccount } from '../data/BudgetContext';
import { KIND_WORDS } from '../utils/kinds';

type Docs = { docs: Map<string, { json: string; schema: number }> };
const docOf = (store: Docs, id: string) => JSON.parse(store.docs.get(id)!.json);
const named = (store: Docs, name: string) =>
  [...store.docs.values()].map(doc => JSON.parse(doc.json)).find(doc => doc.name === name);

type User = Awaited<ReturnType<typeof startBudget>>['user'];

async function pick(user: User, root: HTMLElement, label: string, option: string) {
  await user.click(within(root).getByLabelText(label));
  await user.click(screen.getByRole('option', { name: option }));
}

const section = (name: string) => screen.getByRole('heading', { name }).closest('.MuiPaper-root') as HTMLElement;
const closed = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

/** Money moved once, on a day (from the main account to savings, unless said). */
const move = (id: string, name: string, on: string, cents: number, more: Partial<Parameters<typeof item>[0]> = {}) =>
  item({
    id,
    kind: 'transfer',
    name,
    toAccountId: 'savings',
    schedule: [{ from: on, until: null, repeat: { every: 'once' }, amountCents: cents, weekends: 'keep' }],
    ...more,
  });

const TODAY = { balance: { cents: 100_000, asOf: '2026-11-10' } };
const SAVINGS_TODAY = account('savings', 'Savings', { balance: { cents: 50_000, asOf: '2026-11-10' } });

describe('money moved between accounts', () => {
  it('is scheduled, and marked moved with both balances moving', async () => {
    const { user, store } = await startBudget({ settings: TODAY, accounts: [SAVINGS_TODAY] });
    await user.click(screen.getByRole('button', { name: 'Bills' }));
    const transfers = () => section('Money moved between accounts');
    expect(within(transfers()).getByText(/To savings each month, to pay off a card/)).toBeInTheDocument();
    await user.click(within(transfers()).getByRole('button', { name: 'Add a transfer' }));
    let dialog = screen.getByRole('dialog', { name: 'Add transfer' });
    await user.type(within(dialog).getByLabelText('Name'), 'To savings');
    await user.type(within(dialog).getByLabelText('Amount'), '100');
    // From one account to another: never the same one
    expect(within(dialog).getByLabelText('From')).toHaveTextContent('Main account');
    expect(within(dialog).getByLabelText('To')).toHaveTextContent('Savings');
    await user.click(within(dialog).getByLabelText('To'));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Savings']);
    await user.click(screen.getByRole('option', { name: 'Savings' }));
    // In a transfer's own words
    expect(within(dialog).getByLabelText('Moves on')).toBeInTheDocument();
    expect(within(dialog).getByRole('switch', { name: 'Moves automatically' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('switch', { name: /Set money aside/ })).not.toBeInTheDocument();
    await pick(user, dialog, 'Repeats', 'Once');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await closed();
    const saved = named(store, 'To savings');
    expect(saved).toMatchObject({ kind: 'transfer', toAccountId: 'savings' });
    expect(saved).not.toHaveProperty('accountId');
    expect(store.docs.get(`item~${saved.id}`)!.schema).toBe(4);
    // It isn't a bill: listed with the transfers, not among what's owed
    expect(screen.getByText('No bills yet')).toBeInTheDocument();
    expect(within(transfers()).getByRole('cell', { name: /^To savings/ })).toBeInTheDocument();

    // Marked moved today, where both balances are from today: both are asked about, and move
    const balances = () => [
      docOf(store, 'settings~account').balance.cents,
      docOf(store, 'account~savings').balance.cents,
    ];
    await user.click(within(transfers()).getByRole('button', { name: 'Mark To savings moved' }));
    dialog = screen.getByRole('dialog', { name: 'To savings, Nov 10' });
    expect(within(dialog).getByLabelText('Moved')).toBeChecked();
    expect(within(dialog).getByLabelText('Moved on')).toHaveValue('2026-11-10');
    expect(within(dialog).getByText(/^\$100\.00 to move Nov 10/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole('checkbox', {
        name: 'Move the balances too: Main account $1,000.00 → $900.00, Savings $500.00 → $600.00',
      })
    ).toBeChecked();
    expect(within(dialog).getByText(/A balance from that day or after may count it already/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    const toast = (await screen.findByText('To savings saved, and the balances moved with it')).closest(
      '.MuiPaper-root'
    ) as HTMLElement;
    expect(balances()).toEqual([90_000, 60_000]);
    // One change: Undo puts it all back
    await user.click(within(toast).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(balances()).toEqual([100_000, 50_000]));

    // Edited, it keeps where it goes
    await user.click(within(transfers()).getByRole('button', { name: 'Edit To savings' }));
    dialog = screen.getByRole('dialog', { name: 'Edit To savings' });
    expect(within(dialog).getByLabelText('To')).toHaveTextContent('Savings');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await closed();
  });

  it('shows on each page as moved money: out of one account, into the other', async () => {
    const { user, store } = await startBudget({
      accounts: [account('savings', 'Savings')],
      items: [
        move('put', 'To savings', '2026-11-12', 10_000),
        // Back to the main account, by itself
        move('back', 'Back again', '2026-11-13', 2_000, {
          accountId: 'savings',
          toAccountId: undefined,
          autopay: true,
        }),
        // Still to make, and past due
        move('late', 'Forgotten', '2026-11-09', 500),
      ],
    });
    const row = (name: string) => screen.getAllByText(name)[0].closest('li') as HTMLElement;
    // Every account together: from which to which, and neither out nor in
    expect(row('To savings')).toHaveTextContent('Main account → Savings');
    expect(row('To savings')).toHaveTextContent(/Savings\$100\.00/);
    expect(row('Back again')).toHaveTextContent('Savings → Main account');
    expect(within(row('Back again')).getByText('Automatic')).toBeInTheDocument();
    // Late, it still counts on both sides, and is listed once
    const overdue = section('Overdue and late');
    expect(within(overdue).getAllByRole('listitem')).toHaveLength(1);
    expect(within(overdue).getByText('Overdue')).toBeInTheDocument();
    // Neither a bill due nor income coming in
    expect(screen.getByText('0 bills')).toBeInTheDocument();
    expect(screen.getByText('Coming in').closest('.MuiPaper-root')).toHaveTextContent('$0.00');

    const page = screen.getByRole('main');
    await pick(user, page, 'Showing', 'Savings');
    expect(row('To savings')).toHaveTextContent('+$100.00');
    await pick(user, page, 'Showing', 'Main account');
    expect(row('To savings')).toHaveTextContent('−$100.00');
    await pick(user, page, 'Showing', 'All accounts');

    // Marked moved in one click: no balance is from today, so nothing's asked
    await user.click(screen.getByRole('button', { name: 'Mark To savings moved' }));
    expect(await screen.findByText('To savings marked moved')).toBeInTheDocument();
    expect(docOf(store, 'occ~2026-11-12~put').status).toEqual({ state: 'done', on: '2026-11-10', amountCents: 10_000 });
    expect(within(row('To savings')).getByText('Moved')).toBeInTheDocument();

    // The forecast lists both sides of it, in its own words
    await user.click(screen.getByRole('button', { name: 'Forecast' }));
    expect(screen.getAllByText('To savings (moved)')).toHaveLength(2);
    expect(screen.getAllByText('Back again (automatic)')).toHaveLength(2);
    // Still to make, it counts on both sides too
    expect(screen.getAllByText('Forgotten (overdue)')).toHaveLength(2);

    // The calendar marks the day money moves, by itself
    await user.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(
      await screen.findByRole('button', { name: /November 12, 2026: \$100\.00 moved between accounts/ })
    ).toBeInTheDocument();
    expect(screen.getByText('Moved between accounts')).toBeInTheDocument();

    // Edited, one that goes to the main account still does
    await user.click(screen.getByRole('button', { name: 'Bills' }));
    // (Listed with where each goes, not only where it leaves)
    expect(screen.getAllByText('Main account → Savings').length).toBeGreaterThan(0);
    expect(screen.getByText('Savings → Main account')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit Back again' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Back again' });
    expect(within(dialog).getByLabelText('From')).toHaveTextContent('Savings');
    expect(within(dialog).getByLabelText('To')).toHaveTextContent('Main account');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await closed();
  });

  it('is recorded once from the Overview, moving the balance that’s from that day', async () => {
    const { user, store } = await startBudget({
      settings: TODAY,
      accounts: [account('savings', 'Savings'), account('card', 'Card', { order: 2, balance: null })],
    });
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('menuitem', { name: 'Money moved between accounts' }));
    const dialog = screen.getByRole('dialog', { name: 'Record a one-off' });
    expect(within(dialog).getByRole('button', { name: 'I moved' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByLabelText('What for')).toBeInTheDocument();
    expect(within(dialog).getByText('Savings, a card payment')).toBeInTheDocument();
    // From the main account to the first other, until another is chosen
    expect(within(dialog).getByLabelText('To')).toHaveTextContent('Savings');
    // Only the main account's balance is from today: it's the one that would move
    expect(
      within(dialog).getByRole('checkbox', { name: 'Move the balance too: Main account $1,000.00' })
    ).toBeChecked();
    await pick(user, dialog, 'To', 'Card');
    // Coming from where it was going, it goes somewhere else
    await pick(user, dialog, 'From', 'Card');
    expect(within(dialog).getByLabelText('To')).toHaveTextContent('Main account');
    await user.type(within(dialog).getByLabelText('Amount'), '50');
    await user.type(within(dialog).getByLabelText('What for'), 'Card refund');
    expect(
      within(dialog).getByRole('checkbox', { name: 'Move the balance too: Main account $1,000.00 → $1,050.00' })
    ).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Card refund recorded, and the balances moved with it')).toBeInTheDocument();
    const saved = named(store, 'Card refund');
    expect(saved).toMatchObject({ kind: 'transfer', accountId: 'card' });
    expect(saved).not.toHaveProperty('toAccountId');
    expect(docOf(store, 'settings~account').balance.cents).toBe(105_000);
    // Something spent is still just that: it goes nowhere
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('menuitem', { name: 'A one-off spend or income' }));
    const spent = screen.getByRole('dialog', { name: 'Record a one-off' });
    expect(within(spent).queryByLabelText('To')).not.toBeInTheDocument();
    await user.type(within(spent).getByLabelText('Amount'), '4');
    await user.type(within(spent).getByLabelText('On what'), 'Coffee');
    await user.click(within(spent).getByRole('button', { name: 'Save' }));
    await closed();
    expect(named(store, 'Coffee')).not.toHaveProperty('toAccountId');
  });

  it('is asked about with each account’s balance, and matched by hand on a statement', async () => {
    const { user, store } = await startBudget({
      settings: { balance: { cents: 100_000, asOf: '2026-11-01' } },
      accounts: [account('savings', 'Savings', { balance: { cents: 50_000, asOf: '2026-11-01' } })],
      items: [move('put', 'To savings', '2026-11-05', 10_000), move('more', 'More', '2026-11-06', 20_000)],
    });
    // Savings' balance: the money comes into it; the main account's: it goes out
    await pick(user, screen.getByRole('main'), 'Showing', 'Savings');
    await user.click(screen.getByRole('button', { name: 'Update balance' }));
    const dialog = screen.getByRole('dialog', { name: 'Your balance' });
    await user.type(within(dialog).getByLabelText('Balance'), '600');
    expect(within(dialog).getByRole('checkbox', { name: 'To savings: +$100.00, due Nov 5' })).toBeInTheDocument();
    await pick(user, dialog, 'Account', 'Main account');
    await user.click(within(dialog).getByRole('checkbox', { name: 'To savings: $100.00, due Nov 5' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await closed();
    expect(docOf(store, 'occ~2026-11-05~put').status.state).toBe('done');
    expect(docOf(store, 'settings~account').balance).toEqual({ cents: 60_000, asOf: '2026-11-10' });

    // A statement's line that matched nothing: a transfer is offered the way it goes in that account
    await user.click(screen.getByRole('button', { name: 'Bills' }));
    const csv = 'Date,Description,Amount\n2026-11-06,ONLINE XFER,123.00\n';
    await user.upload(screen.getByLabelText('Bank statement file'), new File([csv], 'savings.csv'));
    const statement = await screen.findByRole('dialog', { name: 'Bank statement' });
    const line = () => within(statement).getByLabelText('ONLINE XFER: +$123.00 on Nov 6');
    // Into the main account, it isn't this transfer out of it
    await pick(user, statement, 'Whose statement', 'Main account');
    await user.click(line());
    // (Left to come after the balance just set: it's due the day after)
    expect(screen.queryByRole('option', { name: 'More, due Nov 11' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Not in BudgetMint: leave it' }));
    await pick(user, statement, 'Whose statement', 'Savings');
    await user.click(line());
    await user.click(screen.getByRole('option', { name: 'More, due Nov 11' }));
    await user.click(within(statement).getByRole('button', { name: 'Save' }));
    await closed();
    expect(docOf(store, 'occ~2026-11-06~more').status).toEqual({
      state: 'done',
      on: '2026-11-06',
      amountCents: 12_300,
    });
  });

  it('goes to another account than it comes from, and has its own words', () => {
    const live = [{ id: 'main' }, { id: 'savings' }, { id: 'card' }] as Parameters<typeof otherAccount>[0];
    expect(otherAccount(live, 'main', null)).toBe('savings');
    expect(otherAccount(live, 'main', 'card')).toBe('card');
    // Not where it comes from, and not one that's gone
    expect(otherAccount(live, 'savings', 'savings')).toBe('main');
    expect(otherAccount(live, 'main', 'gone')).toBe('savings');
    expect(otherAccount(live.slice(0, 1), 'main', null)).toBeNull();
    expect(KIND_WORDS.transfer.sign).toBe('');
    expect(KIND_WORDS.bill.done).toBe('Paid');
  });
});
