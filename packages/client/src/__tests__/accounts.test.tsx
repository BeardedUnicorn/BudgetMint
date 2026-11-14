/**
 * Several bank accounts: the main one every budget has, and others added in
 * Settings, each with its own balance, forecast and low mark. And a budget
 * with only the main account, which sees none of it.
 */

import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { account, item, monthly, startBudget } from './setup/budget';
import { accountBalance, accountName } from '../data/BudgetContext';

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

/** Something once, on a day. */
const once = (id: string, name: string, on: string, cents: number, more: Partial<Parameters<typeof item>[0]> = {}) =>
  item({
    id,
    kind: 'bill',
    name,
    schedule: [{ from: on, until: null, repeat: { every: 'once' }, amountCents: cents, weekends: 'keep' }],
    ...more,
  });

const closed = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

describe('a budget with one bank account', () => {
  it('shows nothing of accounts but the way to add one, and writes nothing new', async () => {
    const { user, store } = await startBudget({
      items: [monthly('rent', 'Rent', 15, 50_000), monthly('net', 'Internet', 20, 6_000)],
    });
    // The Overview: no chooser, no cards, no account named on a row, and the footer is the one balance
    expect(screen.queryByLabelText('Showing')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Your accounts' })).not.toBeInTheDocument();
    expect(screen.queryByText('Main account')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: /^Balance today \$1,000\.00/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accounts$/ })).not.toBeInTheDocument();
    expect(screen.getByText('From your balance of $1,000.00 at the end of Nov 9')).toBeInTheDocument();

    // No account asked for where the balance is set, or a one-off recorded
    await user.click(screen.getByRole('button', { name: 'Update balance' }));
    let dialog = screen.getByRole('dialog', { name: 'Your balance' });
    expect(within(dialog).queryByLabelText('Account')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await closed();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('menuitem', { name: 'A one-off spend or income' }));
    dialog = screen.getByRole('dialog', { name: 'Record a one-off' });
    expect(within(dialog).queryByLabelText('From')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await closed();

    // Bills: no account to filter by or to pay from, and a new bill is the document it always was
    await user.click(screen.getByRole('button', { name: 'Bills' }));
    expect(screen.getByLabelText('Order')).toBeInTheDocument();
    expect(screen.queryByLabelText('Account')).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Add bill' })[0]);
    dialog = screen.getByRole('dialog', { name: 'Add bill' });
    expect(within(dialog).queryByLabelText('Paid from')).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Name'), 'Water');
    await user.type(within(dialog).getByLabelText('Amount'), '30');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await closed();
    const water = named(store, 'Water');
    expect(water).not.toHaveProperty('accountId');
    expect(store.docs.get(`item~${water.id}`)!.schema).toBe(2);
    expect([...store.docs.keys()].filter(id => id.startsWith('account~'))).toEqual([]);

    // A statement isn't asked whose it is
    await user.upload(
      screen.getByLabelText('Bank statement file'),
      new File(['Date,Description,Amount\n2026-11-01,COFFEE,-4.50\n'], 'statement.csv')
    );
    dialog = await screen.findByRole('dialog', { name: 'Bank statement' });
    expect(within(dialog).queryByLabelText('Whose statement')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await closed();

    await user.click(screen.getByRole('button', { name: 'Forecast' }));
    expect(screen.queryByLabelText('Showing')).not.toBeInTheDocument();

    // Settings: only the way to add one
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const bank = section('Bank accounts');
    expect(within(bank).getByText(/BudgetMint forecasts one bank account/)).toBeInTheDocument();
    expect(within(bank).queryByRole('list')).not.toBeInTheDocument();
    expect(
      within(bank)
        .getAllByRole('button')
        .map(button => button.textContent)
    ).toEqual(['Add a bank account']);
  });
});

describe('several bank accounts', () => {
  it('adds one in Settings with its balance, names the main one, and pays a bill from it', async () => {
    const { user, store } = await startBudget({
      items: [monthly('rent', 'Rent', 15, 50_000), monthly('net', 'Internet', 20, 6_000)],
    });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const bank = section('Bank accounts');
    await user.click(within(bank).getByRole('button', { name: 'Add a bank account' }));
    let dialog = screen.getByRole('dialog', { name: 'Add a bank account' });
    // Left as it opened, it closes without a word
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await closed();
    await user.click(within(bank).getByRole('button', { name: 'Add a bank account' }));
    dialog = screen.getByRole('dialog', { name: 'Add a bank account' });
    // What core refuses is said where it's wrong
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Give it a name')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toHaveFocus();
    await user.type(within(dialog).getByLabelText('Name'), 'Savings');
    const low = within(dialog).getByLabelText('Low balance mark (optional)');
    await user.type(low, '.');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Enter an amount, or leave it empty for none')).toBeInTheDocument();
    await user.clear(low);
    await user.type(low, '100');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Savings added')).toBeInTheDocument();

    // A new account has no balance yet: asked for next, with the account chosen
    dialog = await screen.findByRole('dialog', { name: 'Your balance' });
    expect(within(dialog).getByLabelText('Account')).toHaveTextContent('Savings');
    await user.type(within(dialog).getByLabelText('Balance'), '500');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await closed();
    const savings = named(store, 'Savings');
    expect(savings).toMatchObject({ balance: { cents: 50_000, asOf: '2026-11-10' }, lowBalanceCents: 10_000 });
    expect(store.docs.get(`account~${savings.id}`)!.schema).toBe(4);
    // The main account's balance is where it always was, untouched
    expect(docOf(store, 'settings~account').balance).toEqual({ cents: 100_000, asOf: '2026-11-09' });

    const list = within(bank).getByRole('list', { name: 'Bank accounts' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Main account');
    expect(within(rows[0]).getByText('Main')).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('$1,000.00 at the end of Nov 9');
    expect(rows[1]).toHaveTextContent('Savings');
    expect(rows[1]).toHaveTextContent('$500.00 at the end of Nov 10');

    // The main account named: one name each
    await user.click(within(list).getByRole('button', { name: 'Edit Main account' }));
    dialog = screen.getByRole('dialog', { name: 'Edit Main account' });
    const name = within(dialog).getByLabelText('Name');
    expect(within(dialog).getByLabelText('Low balance mark (optional)')).toHaveValue('');
    await user.clear(name);
    await user.type(name, 'savings');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Another account has that name')).toBeInTheDocument();
    await user.clear(name);
    await user.type(name, 'Checking');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Checking saved')).toBeInTheDocument();
    await closed();
    expect(docOf(store, 'account~main')).toMatchObject({ name: 'Checking', balance: null });

    // A bill paid from savings: a newer document, with its account
    await user.click(screen.getByRole('button', { name: 'Bills' }));
    await user.click(screen.getAllByRole('button', { name: 'Add bill' })[0]);
    dialog = screen.getByRole('dialog', { name: 'Add bill' });
    expect(within(dialog).getByLabelText('Paid from')).toHaveTextContent('Checking');
    await pick(user, dialog, 'Paid from', 'Savings');
    await user.type(within(dialog).getByLabelText('Name'), 'Fee');
    await user.type(within(dialog).getByLabelText('Amount'), '7');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await closed();
    const fee = named(store, 'Fee');
    expect(fee.accountId).toBe(savings.id);
    expect(store.docs.get(`item~${fee.id}`)!.schema).toBe(4);
    // Each row says its account, and the list narrows to one
    const row = (bill: string) => screen.getByRole('cell', { name: new RegExp(`^${bill}`) }).closest('tr')!;
    expect(within(row('Fee')).getByText('Savings')).toBeInTheDocument();
    expect(within(row('Rent')).getByText('Checking')).toBeInTheDocument();
    const page = screen.getByRole('main');
    await pick(user, page, 'Account', 'Savings');
    expect(screen.queryByRole('cell', { name: /^Rent/ })).not.toBeInTheDocument();
    expect(row('Fee')).toBeInTheDocument();
    await pick(user, page, 'Account', 'Every account');
    expect(row('Rent')).toBeInTheDocument();
    // Edited, it stays in its account
    await user.click(screen.getByRole('button', { name: 'Edit Fee' }));
    dialog = screen.getByRole('dialog', { name: 'Edit Fee' });
    expect(within(dialog).getByLabelText('Paid from')).toHaveTextContent('Savings');
    await user.type(within(dialog).getByLabelText('Name'), 's');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await closed();
    expect(named(store, 'Fees').accountId).toBe(savings.id);

    // The Overview: each account at a glance, and the page of all or of one
    await user.click(screen.getByRole('button', { name: 'Overview' }));
    const cards = screen.getByRole('region', { name: 'Your accounts' });
    expect(within(cards).getByRole('group', { name: 'Checking' })).toHaveTextContent('$1,000.00');
    // (The fee is due today, and savings' balance is from today: still owed, so it's off already)
    expect(within(cards).getByRole('group', { name: 'Savings' })).toHaveTextContent('$493.00');
    expect(screen.getByText('Your accounts together')).toBeInTheDocument();
    await pick(user, page, 'Showing', 'Savings');
    expect(screen.getByText('From the Savings balance of $500.00 at the end of Nov 10')).toBeInTheDocument();
    // Its balance is the one updated from here, unless another is chosen
    await user.click(screen.getByRole('button', { name: 'Update balance' }));
    dialog = screen.getByRole('dialog', { name: 'Your balance' });
    expect(within(dialog).getByLabelText('Account')).toHaveTextContent('Savings');
    expect(within(dialog).getByText('Last: $500.00, at the end of Nov 10')).toBeInTheDocument();
    await pick(user, dialog, 'Account', 'Checking');
    expect(within(dialog).getByText('Last: $1,000.00, at the end of Nov 9')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Balance'), '900');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await closed();
    expect(docOf(store, 'settings~account').balance).toEqual({ cents: 90_000, asOf: '2026-11-10' });
    expect(named(store, 'Savings').balance.cents).toBe(50_000);

    // The Forecast shares the choice
    await user.click(screen.getByRole('button', { name: 'Forecast' }));
    expect(screen.getByLabelText('Showing')).toHaveTextContent('Savings');
    expect(screen.getByText(/^The next 60 days: \$493\.00 today/)).toBeInTheDocument();
    await pick(user, screen.getByRole('main'), 'Showing', 'All accounts');
    expect(screen.getByText(/^The next 60 days: \$1,393\.00 today/)).toBeInTheDocument();
  });

  it('flags each account by its own balance, and leaves out of the total one it can’t go by', async () => {
    const { user } = await startBudget({
      settings: { balance: { cents: 100_000, asOf: '2026-11-09' }, lowBalanceCents: 20_000 },
      accounts: [
        account('savings', 'Savings', { lowBalanceCents: 45_000 }),
        account('card', 'Card', { order: 2, balance: null }),
        account('old', 'Old', { order: 3, balance: { cents: 80_000, asOf: '2026-09-01' } }),
        account('loan', 'Loan', { order: 4, balance: { cents: -5_000, asOf: '2026-11-09' } }),
      ],
      items: [
        once('rent', 'Rent', '2026-11-12', 95_000),
        once('fee', 'Fee', '2026-11-13', 60_000, { accountId: 'savings' }),
      ],
    });
    // Together: the loan is below zero today already
    expect(screen.getByText('Your accounts together')).toBeInTheDocument();
    expect(screen.getByText(/One of your accounts goes below zero on Tue, Nov 10, to -\$50\.00\./)).toBeInTheDocument();
    expect(screen.getByText(/What each account can spare, added up/)).toBeInTheDocument();
    const cards = screen.getByRole('region', { name: 'Your accounts' });
    const card = (name: string) => within(cards).getByRole('group', { name });
    expect(card('Main account')).toHaveTextContent('Low Thu, Nov 12');
    expect(card('Savings')).toHaveTextContent('Below zero Fri, Nov 13');
    expect(card('Savings')).toHaveTextContent('Safe to spend $0.00');
    expect(card('Card')).toHaveTextContent('No balance yet: not in the total.');
    expect(card('Old')).toHaveTextContent('Its balance is from Sep 1: too old to count in the total. Update it.');
    expect(card('Loan')).toHaveTextContent('-$50.00');
    // Each row says which account it's in
    const upcoming = section('The next 14 days');
    expect(within(upcoming).getByText('Savings')).toBeInTheDocument();
    expect(within(upcoming).getByText('Main account')).toBeInTheDocument();

    // The footer: all of them, and each on a tap
    const footer = screen.getByRole('group', { name: /^Balance today, all accounts \$1,450\.00/ });
    expect(within(footer).getByText('Today, all accounts')).toBeInTheDocument();
    await user.click(within(footer).getByRole('button', { name: '5 accounts' }));
    const each = screen.getByRole('list', { name: 'Each account today' });
    expect(
      within(each)
        .getAllByRole('listitem')
        .map(row => row.textContent)
    ).toEqual([
      'Main account$1,000.00',
      'Savings$500.00',
      'CardNot in the total',
      'OldNot in the total',
      'Loan-$50.00',
    ]);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Each account today' })).not.toBeInTheDocument());

    // One account: its own balance, by its own mark
    const page = screen.getByRole('main');
    await pick(user, page, 'Showing', 'Savings');
    expect(screen.getByText(/The Savings balance goes below zero on Fri, Nov 13, to -\$100\.00\./)).toBeInTheDocument();
    await pick(user, page, 'Showing', 'Main account');
    expect(
      screen.getByText(/The Main account balance goes below \$200\.00 on Thu, Nov 12, to \$50\.00\./)
    ).toBeInTheDocument();
    expect(screen.queryByText(/What each account can spare/)).not.toBeInTheDocument();
  });

  it('says when one of them only gets low', async () => {
    await startBudget({
      accounts: [account('savings', 'Savings', { lowBalanceCents: 45_000 })],
      items: [once('fee', 'Fee', '2026-11-13', 10_000, { accountId: 'savings' })],
    });
    expect(
      screen.getByText(/One of your accounts goes below its low mark on Fri, Nov 13, to \$400\.00\./)
    ).toBeInTheDocument();
  });

  it('moves the balance of the account the money is in', async () => {
    // Both balances set today: what's paid today may have gone after
    const { user, store } = await startBudget({
      settings: { balance: { cents: 100_000, asOf: '2026-11-10' } },
      accounts: [account('savings', 'Savings', { balance: { cents: 50_000, asOf: '2026-11-10' } })],
      items: [once('fee', 'Fee', '2026-11-12', 700, { accountId: 'savings' })],
    });
    const balances = () => [
      docOf(store, 'settings~account').balance.cents,
      docOf(store, 'account~savings').balance.cents,
    ];
    await user.click(screen.getByRole('button', { name: 'Mark Fee paid' }));
    let dialog = screen.getByRole('dialog', { name: 'Fee, Nov 12' });
    expect(
      within(dialog).getByRole('checkbox', { name: 'Take it off the Savings balance: $500.00 → $493.00' })
    ).toBeChecked();
    expect(
      within(dialog).getByText('The Savings balance is from the same day, Nov 10. Untick this if it counts it already.')
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await closed();
    expect(balances()).toEqual([100_000, 49_300]);

    // A one-off, from the account chosen
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('menuitem', { name: 'A one-off spend or income' }));
    dialog = screen.getByRole('dialog', { name: 'Record a one-off' });
    await user.click(within(dialog).getByRole('button', { name: 'I got' }));
    expect(within(dialog).getByLabelText('Into')).toHaveTextContent('Main account');
    await user.click(within(dialog).getByRole('button', { name: 'I spent' }));
    await pick(user, dialog, 'From', 'Savings');
    await user.type(within(dialog).getByLabelText('Amount'), '20');
    await user.type(within(dialog).getByLabelText('On what'), 'Gift');
    expect(
      within(dialog).getByRole('checkbox', { name: 'Take it off the Savings balance: $493.00 → $473.00' })
    ).toBeChecked();
    // Before its balance's day, the balance likely has it
    const when = within(dialog).getByLabelText('When');
    await user.clear(when);
    await user.type(when, '2026-11-08');
    expect(
      within(dialog).getByText('It’s before the Savings balance’s day, Nov 10: the balance likely counts it already.')
    ).toBeInTheDocument();
    await user.clear(when);
    await user.type(when, '2026-11-10');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await closed();
    expect(balances()).toEqual([100_000, 47_300]);
    expect(named(store, 'Gift').accountId).toBe('savings');
  });

  it('reads a statement as one account’s, and settles that one', async () => {
    const { user, store } = await startBudget({
      accounts: [account('savings', 'Savings')],
      items: [once('fee', 'Fee', '2026-11-05', 700, { accountId: 'savings' }), monthly('rent', 'Rent', 15, 50_000)],
    });
    await user.click(screen.getByRole('button', { name: 'Bills' }));
    const ofx = [
      'OFXHEADER:100',
      '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>',
      '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261105<TRNAMT>-7.00<NAME>FEE</STMTTRN>',
      '</BANKTRANLIST><LEDGERBAL><BALAMT>493.00<DTASOF>20261106</LEDGERBAL>',
      '</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
    ].join('\n');
    await user.upload(screen.getByLabelText('Bank statement file'), new File([ofx], 'savings.ofx'));
    const dialog = await screen.findByRole('dialog', { name: 'Bank statement' });
    // Asked first, with nothing to save until it's said: a savings statement taken as the
    // main account's would set the wrong balance
    expect(within(dialog).getByText('Which account is this statement from?')).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    // The main account's: its fee isn't that account's
    await pick(user, dialog, 'Whose statement', 'Main account');
    expect(within(dialog).getByText('None of it matches a bill or income still open.')).toBeInTheDocument();
    await pick(user, dialog, 'Whose statement', 'Savings');
    expect(within(dialog).getByRole('checkbox', { name: 'Fee, due Nov 5: $7.00 on Nov 5' })).toBeChecked();
    expect(
      within(dialog).getByRole('checkbox', { name: 'Set your balance to $493.00, as of the end of Nov 6, 2026' })
    ).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await closed();
    expect(docOf(store, 'occ~2026-11-05~fee').status).toEqual({ state: 'done', on: '2026-11-05', amountCents: 700 });
    expect(docOf(store, 'account~savings').balance).toEqual({ cents: 49_300, asOf: '2026-11-06' });
    // The main account is as it was
    expect(docOf(store, 'settings~account').balance).toEqual({ cents: 100_000, asOf: '2026-11-09' });
  });

  it('archives an account with nothing live in it, brings it back, and deletes an empty one', async () => {
    const { user, store } = await startBudget({
      accounts: [account('savings', 'Savings'), account('spare', 'Spare', { order: 2, balance: null })],
      items: [once('fee', 'Fee', '2026-11-20', 700, { accountId: 'savings' })],
    });
    // The Overview is of the spare account, until it's no longer in use
    await pick(user, screen.getByRole('main'), 'Showing', 'Spare');
    expect(screen.getByText('Set your balance to see where it goes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const bank = section('Bank accounts');
    // With a bill in it, an account stays: core says why
    await user.click(within(bank).getByRole('button', { name: 'Archive Savings' }));
    expect(await screen.findByText(/It still has bills, income or transfers/)).toBeInTheDocument();
    expect(within(bank).queryByRole('button', { name: 'Delete Savings' })).not.toBeInTheDocument();
    expect(within(bank).queryByRole('button', { name: 'Archive Main account' })).not.toBeInTheDocument();
    // Its balance is set from its row
    await user.click(within(bank).getByRole('button', { name: 'Set the Spare balance' }));
    const balance = screen.getByRole('dialog', { name: 'Your balance' });
    expect(within(balance).getByLabelText('Account')).toHaveTextContent('Spare');
    await user.click(within(balance).getByRole('button', { name: 'Cancel' }));
    await closed();
    expect(within(bank).getByRole('button', { name: 'Update the Savings balance' })).toBeInTheDocument();

    await user.click(within(bank).getByRole('button', { name: 'Archive Spare' }));
    expect(await screen.findByText('Spare archived')).toBeInTheDocument();
    expect(docOf(store, 'account~spare').archived).toBe(true);
    expect(within(bank).getByText('Archived')).toBeInTheDocument();
    expect(within(bank).queryByRole('button', { name: 'Edit Spare' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Overview' }));
    expect(screen.getByLabelText('Showing')).toHaveTextContent('All accounts');
    expect(within(screen.getByRole('region', { name: 'Your accounts' })).queryByText('Spare')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(within(section('Bank accounts')).getByRole('button', { name: 'Bring back Spare' }));
    expect(await screen.findByText('Spare brought back')).toBeInTheDocument();
    await user.click(within(section('Bank accounts')).getByRole('button', { name: 'Delete Spare' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete Spare?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Spare deleted')).toBeInTheDocument();
    await closed();
    expect(store.docs.has('account~spare')).toBe(false);

    // Deleted on another device while it's being edited here: its dialog goes with it
    await user.click(within(section('Bank accounts')).getByRole('button', { name: 'Edit Savings' }));
    expect(screen.getByRole('dialog', { name: 'Edit Savings' })).toBeInTheDocument();
    store.putDoc('account~savings', null);
    await closed();
    expect(within(section('Bank accounts')).getByText(/BudgetMint forecasts one bank account/)).toBeInTheDocument();
  });

  it('keeps the main account listed once it’s named, even alone, and says when a name is its', async () => {
    const { user, store } = await startBudget({ accounts: [account('old', 'Old venmo', { balance: null })] });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const bank = section('Bank accounts');
    await user.click(within(bank).getByRole('button', { name: 'Edit Main account' }));
    let dialog = screen.getByRole('dialog', { name: 'Edit Main account' });
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Venmo');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await closed();
    await user.click(within(bank).getByRole('button', { name: 'Delete Old venmo' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete Old venmo?' })).getByRole('button', { name: 'Delete' })
    );
    expect(await screen.findByText('Old venmo deleted')).toBeInTheDocument();
    await closed();
    expect(store.docs.has('account~old')).toBe(false);

    // The one left is still there to see and rename: its name is the user's
    const list = within(bank).getByRole('list', { name: 'Bank accounts' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Venmo');
    expect(within(rows[0]).getByText('Main')).toBeInTheDocument();
    // So a new one can't quietly take its name
    await user.click(within(bank).getByRole('button', { name: 'Add a bank account' }));
    dialog = screen.getByRole('dialog', { name: 'Add a bank account' });
    await user.type(within(dialog).getByLabelText('Name'), 'venmo');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Your main account has that name')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    await closed();

    // Named back as it was, the budget is a one-account one again
    await user.click(within(list).getByRole('button', { name: 'Edit Venmo' }));
    dialog = screen.getByRole('dialog', { name: 'Edit Venmo' });
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Main account');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await closed();
    expect(within(bank).queryByRole('list')).not.toBeInTheDocument();
    expect(within(bank).getByText(/BudgetMint forecasts one bank account/)).toBeInTheDocument();
  });

  it('says why an account can’t be added, when it isn’t about its name', async () => {
    const { user } = await startBudget({
      accounts: Array.from({ length: 12 }, (_, at) => account(`a${at}`, `Account ${at}`, { order: at + 1 })),
    });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(within(section('Bank accounts')).getByRole('button', { name: 'Add a bank account' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a bank account' });
    await user.type(within(dialog).getByLabelText('Name'), 'One more');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'BudgetMint keeps up to 12 accounts besides the main one'
    );
  });

  it('names an account by its id, and one that isn’t there by nothing', () => {
    const accounts = [{ id: 'savings', name: 'Savings' }] as Parameters<typeof accountName>[0];
    expect(accountName(accounts, 'savings')).toBe('Savings');
    expect(accountName(accounts, 'gone')).toBe('');
    expect(accountBalance(accounts, 'gone')).toBeNull();
    expect(accountBalance(accounts, 'savings')).toBeNull();
    expect(vi.isMockFunction(accountName)).toBe(false);
  });
});
