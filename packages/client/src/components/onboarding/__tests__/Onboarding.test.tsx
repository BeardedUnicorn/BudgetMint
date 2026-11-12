import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { startBudget } from '../../../__tests__/setup/budget';

type Started = Awaited<ReturnType<typeof startBudget>>;

const itemsOf = (store: Started['store']) =>
  [...store.docs.values()].map(doc => JSON.parse(doc.json)).filter(doc => doc.schedule);

const next = (user: Started['user']) => user.click(screen.getByRole('button', { name: 'Next' }));

/** Onboarding at its pay step, the balance given (as of today) or skipped. */
async function atPay(balance: string | null = '2,340.55') {
  const started = await startBudget({ settings: null });
  if (balance === null) await started.user.click(screen.getByRole('button', { name: 'Skip' }));
  else {
    await started.user.type(screen.getByLabelText('Balance'), balance);
    await next(started.user);
  }
  expect(screen.getByRole('heading', { name: 'Your pay' })).toBeInTheDocument();
  return started;
}

describe('onboarding', () => {
  it('keeps the pay it saved when gone back to, and changes that one', async () => {
    const { user, store } = await atPay();
    await user.type(screen.getByLabelText('Each pays'), '1820');
    expect(screen.queryByText(/^Saved/)).not.toBeInTheDocument();
    await next(user);
    expect(itemsOf(store)).toHaveLength(1);

    // Back: it's there as it was saved, and says so
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Each pays')).toHaveValue('1820');
    expect(screen.getByText('Saved. A change here changes it.')).toBeInTheDocument();
    // On again, unchanged: still the one
    await next(user);
    expect(itemsOf(store)).toHaveLength(1);

    // Back, and changed: the same paycheck, with the new amount
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.clear(screen.getByLabelText('Each pays'));
    await user.type(screen.getByLabelText('Each pays'), '1900');
    await next(user);
    const items = itemsOf(store);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Paycheck', schedule: [{ amountCents: 190_000 }] });

    // Skipped past on the way through again: it stays
    await user.click(screen.getByRole('button', { name: 'Back' }));
    for (const _ of [1, 2, 3]) await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(itemsOf(store)).toHaveLength(1);
  });

  it('says when the payday is taken as already in the balance', async () => {
    const { user } = await atPay();
    // Today, as the balance is
    const hint = /on or before your balance’s day, so BudgetMint takes this one as already in your balance/;
    expect(screen.getByText(hint)).toHaveTextContent('Starting Tue, Nov 10.');
    fireEvent.change(screen.getByLabelText('Next payday'), { target: { value: '2026-11-13' } });
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    expect(screen.getByText('Starting Fri, Nov 13')).toBeInTheDocument();
    // A repeat that isn't one yet: nothing to say
    await user.click(screen.getByLabelText('Repeats'));
    await user.click(screen.getByRole('option', { name: 'Something else…' }));
    fireEvent.change(screen.getByLabelText('Next payday'), { target: { value: '2026-11-10' } });
    expect(screen.getByText(hint)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Every how many weeks'), { target: { value: '' } });
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
  });

  it('says nothing of the balance about a payday when there’s no balance', async () => {
    await atPay(null);
    expect(screen.getByText('Starting Tue, Nov 10')).toBeInTheDocument();
  });

  it('starts each bill on the 1st, and says when its first is taken as in the balance', async () => {
    const { user, store } = await atPay();
    for (const _ of [1, 2]) await user.click(screen.getByRole('button', { name: 'Skip' }));
    await user.click(screen.getByRole('checkbox', { name: 'Internet' }));
    const internet = screen.getByRole('group', { name: 'Internet' });
    await user.type(within(internet).getByLabelText('Amount'), '65');
    // Not today's day of the month (the 10th)
    const due = within(internet).getByLabelText('Due on');
    expect(due).toHaveTextContent('The 1st');
    const hint = /^Its first, Nov 10, is taken as already in your balance/;
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    // Due today, the balance's day
    await user.click(due);
    await user.click(screen.getByRole('option', { name: 'The 10th' }));
    expect(screen.getByText(hint)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(itemsOf(store)).toMatchObject([{ name: 'Internet', schedule: [{ repeat: { day: 10 } }] }]);
  });

  it('keeps each bill’s fields in place, hidden until it’s ticked, so ticking moves no row', async () => {
    const { user } = await atPay();
    for (const _ of [1, 2]) await user.click(screen.getByRole('button', { name: 'Skip' }));
    // There already, taking their room, but not shown or reachable
    expect(screen.getAllByLabelText('Amount')).toHaveLength(7);
    const amount = screen.getAllByLabelText('Amount')[1];
    expect(amount).not.toBeVisible();
    expect(screen.queryByRole('group', { name: 'Phone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Amount' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Due on' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Phone' }));
    // The same field, shown
    expect(within(screen.getByRole('group', { name: 'Phone' })).getByRole('textbox', { name: 'Amount' })).toBe(amount);
    expect(amount).toBeVisible();
    expect(screen.getAllByRole('combobox', { name: 'Due on' })).toHaveLength(1);
    // Unticked, hidden again, with what was typed
    await user.type(amount, '40');
    await user.click(screen.getByRole('checkbox', { name: 'Phone' }));
    expect(amount).not.toBeVisible();
    expect(amount).toHaveValue('40');
  });

  it('says which currency amounts are in, and changes it', async () => {
    const { user, store } = await startBudget({ settings: null });
    expect(screen.getByText(/^Amounts are in US dollars\./)).toBeInTheDocument();
    expect(screen.queryByLabelText('Currency')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    // The picker, open
    await user.click(await screen.findByRole('option', { name: 'Euro (EUR)' }));
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(screen.getByText(/^Amounts are in euros\./)).toBeInTheDocument();
    expect(screen.getByLabelText('Currency')).toHaveTextContent('Euro (EUR)');
    await user.type(screen.getByLabelText('Balance'), '100');
    expect(screen.getByText('Starting from €100.00')).toBeInTheDocument();
    // It holds through the steps (pay saved on the way), and is kept at the end
    await next(user);
    await user.type(screen.getByLabelText('Each pays'), '1820');
    await next(user);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('€')).toBeInTheDocument();
    for (const _ of [1, 2, 3]) await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(JSON.parse(store.docs.get('settings~account')!.json).currency).toBe('EUR');
  });
});
