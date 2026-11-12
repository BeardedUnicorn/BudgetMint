/**
 * The smaller paths through the pages and their parts: an occurrence's
 * dialog, what shows in dark mode, refusals that come from data changed
 * elsewhere, and the like.
 */

import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import type { CalendarDay } from '@budgetmint/contracts';
import { ErrorBoundary } from '../components/layout/ErrorBoundary';
import { CoreStopped } from '../core';
import { createAppTheme } from '../theme';
import { cloudErrorMessage } from '../cloud/errors';
import { getShell, setShell } from '../shell';
import { useNavigation } from '../contexts/NavigationContext';
import { useBudget } from '../data/BudgetContext';
import { DayCell } from '../components/pages/calendar/DayCell';
import { DayDialog } from '../components/pages/calendar/DayDialog';
import { axisMoney, tooltipDay, tooltipMoney } from '../components/pages/forecast/ForecastPage';
import { PageContainer } from '../components/layout/PageLayout';
import { EmptyState } from '../components/ui/display/EmptyState';
import { formatDateTime } from '../utils/locale';
import { cal, createFakeStore, TEST_NOW } from '../testing';
import { BudgetSession } from '../cloud/session';
import { testCore } from '../testing';
import { forecastDoc, item, monthly, override, startBudget } from './setup/budget';

vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    // jsdom lays nothing out: give the chart a size
    ResponsiveContainer: ({ children }: { children: ReactElement }) => (
      <div>
        {cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 600, height: 300 })}
      </div>
    ),
  };
});

const day = (changes: Partial<CalendarDay>): CalendarDay => ({
  date: '2026-11-12',
  occurrences: [],
  billsCents: 0,
  incomeCents: 0,
  withdrawalCents: 0,
  withdrawalUncertainCents: 0,
  withdrawalProjected: false,
  spendingCents: 0,
  earnedCents: 0,
  earnedUncertainCents: 0,
  earnedArrivesOn: null,
  closingCents: null,
  short: false,
  low: false,
  ...changes,
});

describe('an occurrence’s dialog', () => {
  it('says under the amount that it’s missing, and puts the cursor there', async () => {
    const { user } = await startBudget({ items: [monthly('rent', 'Rent', 12, 50_000)] });
    await user.click(screen.getByRole('button', { name: 'Rent on Nov 12: details' }));
    const dialog = screen.getByRole('dialog', { name: 'Rent, Nov 12' });
    // Still to come, with this time's amount emptied
    const expected = within(dialog).getByLabelText('This time');
    await user.clear(expected);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(expected).toBeInvalid();
    expect(expected).toHaveAccessibleDescription('Enter the amount');
    expect(expected).toHaveFocus();
    // Paid instead: the amount still to come no longer matters, the amount paid does
    await user.click(within(dialog).getByRole('radio', { name: 'Paid' }));
    const paid = within(dialog).getByLabelText('Amount');
    await user.clear(paid);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(paid).toBeInvalid();
    expect(paid).toHaveFocus();
    await user.type(paid, '500');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('goes back to the usual amount, and stays open on a click outside it', async () => {
    const { user, store } = await startBudget({
      items: [monthly('rent', 'Rent', 12, 50_000)],
      overrides: [override({ itemId: 'rent', date: '2026-11-12', status: { state: 'open' }, amountCents: 45_000 })],
    });
    await user.click(screen.getByRole('button', { name: 'Rent on Nov 12: details' }));
    const dialog = screen.getByRole('dialog', { name: 'Rent, Nov 12' });
    expect(within(dialog).getByLabelText('This time')).toHaveValue('450.00');
    // A click outside doesn't throw the form away; Escape would
    await user.click(document.querySelector('.MuiBackdrop-root')!);
    expect(dialog).toBeInTheDocument();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Back to the usual amount' }));
    expect(within(dialog).getByLabelText('This time')).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    // Nothing of its own left: it follows the schedule again
    await waitFor(() => expect(store.docs.has('occ~2026-11-12~rent')).toBe(false));
    expect(await screen.findByText('−$500.00')).toBeInTheDocument();
  });

  it('leaves the amount following the schedule when only a note changes', async () => {
    const { user, store } = await startBudget({
      items: [monthly('rent', 'Rent', 12, 50_000)],
      overrides: [override({ itemId: 'rent', date: '2026-11-12', status: { state: 'open' }, note: 'Ask first' })],
    });
    await user.click(screen.getByRole('button', { name: 'Rent on Nov 12: details' }));
    const dialog = screen.getByRole('dialog', { name: 'Rent, Nov 12' });
    await user.type(within(dialog).getByLabelText('Note (optional)'), ', then pay');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(JSON.parse(store.docs.get('occ~2026-11-12~rent')!.json)).toMatchObject({
        amountCents: null,
        note: 'Ask first, then pay',
      })
    );
  });

  it('marks it paid on a day for an amount, moves it, and opens it again', async () => {
    const { user, store } = await startBudget({ items: [monthly('rent', 'Rent', 12, 50_000)] });
    const details = () => screen.getByRole('button', { name: 'Rent on Nov 12: details' });
    await user.click(details());
    let dialog = screen.getByRole('dialog', { name: 'Rent, Nov 12' });
    expect(within(dialog).getByText('$500.00 due Nov 12')).toBeInTheDocument();
    // This time: less, and on the 14th, with a note
    const amount = within(dialog).getByLabelText('This time');
    await user.clear(amount);
    await user.type(amount, '450');
    fireEvent.change(within(dialog).getByLabelText('Due'), { target: { value: '2026-11-14' } });
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Agreed');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(JSON.parse(store.docs.get('occ~2026-11-12~rent')!.json)).toMatchObject({
        amountCents: 45_000,
        movedTo: '2026-11-14',
        note: 'Agreed',
      })
    );

    await user.click(screen.getByRole('button', { name: 'Rent on Nov 12: details' }));
    dialog = screen.getByRole('dialog', { name: 'Rent, Nov 12' });
    await user.click(within(dialog).getByRole('radio', { name: 'Paid' }));
    const paid = within(dialog).getByLabelText('Amount');
    await user.clear(paid);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Enter the amount')).toBeInTheDocument();
    await user.type(paid, '450');
    fireEvent.change(within(dialog).getByLabelText('Paid on'), { target: { value: '2026-12-31' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      within(dialog).getByText("It can't be paid later than tomorrow: mark it paid once it is")
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Paid on'), { target: { value: '2026-11-10' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(JSON.parse(store.docs.get('occ~2026-11-12~rent')!.json).status).toEqual({
        state: 'done',
        on: '2026-11-10',
        amountCents: 45_000,
      })
    );

    // Open again, as it was (a paid one's dialog starts on its payment)
    await user.click(screen.getByRole('button', { name: 'Rent on Nov 12: details' }));
    dialog = screen.getByRole('dialog', { name: 'Rent, Nov 12' });
    expect(within(dialog).getByRole('radio', { name: 'Paid' })).toBeChecked();
    await user.click(within(dialog).getByRole('radio', { name: 'Still to pay' }));
    fireEvent.change(within(dialog).getByLabelText('Due'), { target: { value: '2026-11-12' } });
    await user.clear(within(dialog).getByLabelText('Note (optional)'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(JSON.parse(store.docs.get('occ~2026-11-12~rent')!.json)).toMatchObject({ movedTo: null, note: null })
    );
  });

  it('starts a payment today, as Mark paid does, and words income as received', async () => {
    const pay = item({
      id: 'pay',
      kind: 'income',
      name: 'Pay',
      autopay: true,
      schedule: [{ from: '2026-11-13', until: null, repeat: { every: 'once' }, amountCents: 9_000, weekends: 'keep' }],
    });
    const { user } = await startBudget({
      items: [pay, monthly('water', 'Water', 9, 1_000)],
      settings: { balance: { cents: 1, asOf: '2026-11-08' } },
    });
    await user.click(screen.getByRole('button', { name: 'Pay on Nov 13: details' }));
    let dialog = screen.getByRole('dialog', { name: 'Pay, Nov 13' });
    expect(within(dialog).getByText('$90.00 due Nov 13, comes in automatically')).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Still to come' })).toBeChecked();
    await user.click(within(dialog).getByRole('radio', { name: 'Received' }));
    expect(within(dialog).getByLabelText('Received on')).toHaveValue('2026-11-10');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Water on Nov 9: details' }));
    dialog = screen.getByRole('dialog', { name: 'Water, Nov 9' });
    await user.click(within(dialog).getByRole('radio', { name: 'Paid' }));
    expect(within(dialog).getByLabelText('Paid on')).toHaveValue('2026-11-10');
  });

  it('asks what a bill whose amount varies came to, instead of taking its estimate', async () => {
    const { user, store } = await startBudget({
      items: [
        monthly('gas', 'Gas', 12, 4_000, { varies: true }),
        monthly('power', 'Power', 8, 6_000, { varies: true, autopay: true }),
      ],
    });
    // Mark paid opens it, paid today, with the amount to type
    await user.click(screen.getByRole('button', { name: 'Mark Gas paid' }));
    let dialog = screen.getByRole('dialog', { name: 'Gas, Nov 12' });
    expect(within(dialog).getByRole('radio', { name: 'Paid' })).toBeChecked();
    expect(within(dialog).getByLabelText('Paid on')).toHaveValue('2026-11-10');
    expect(within(dialog).getByLabelText('Amount')).toHaveValue('');
    expect(within(dialog).getByLabelText('Amount')).toHaveFocus();
    // Nothing typed yet: Escape just closes it, and nothing was recorded
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(store.docs.has('occ~2026-11-12~gas')).toBe(false);

    // On autopay, it's asked once it's due: paid on its day
    const asked = screen.getByRole('region', { name: 'What did these come to?' });
    await user.click(within(asked).getByRole('button', { name: 'Enter what Power came to on Nov 8' }));
    dialog = screen.getByRole('dialog', { name: 'Power, Nov 8' });
    expect(within(dialog).getByLabelText('Paid on')).toHaveValue('2026-11-08');
    await user.type(within(dialog).getByLabelText('Amount'), '71.25');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(JSON.parse(store.docs.get('occ~2026-11-08~power')!.json).status).toEqual({
        state: 'done',
        on: '2026-11-08',
        amountCents: 7_125,
      })
    );
    // October's is still to say
    await waitFor(() =>
      expect(within(asked).queryByRole('button', { name: 'Enter what Power came to on Nov 8' })).toBeNull()
    );
    expect(within(asked).getByRole('button', { name: 'Enter what Power came to on Oct 8' })).toBeInTheDocument();
  });

  it('asks before Escape throws a change away', async () => {
    const { user, store } = await startBudget({ items: [monthly('rent', 'Rent', 12, 50_000)] });
    await user.click(screen.getByRole('button', { name: 'Rent on Nov 12: details' }));
    const dialog = screen.getByRole('dialog', { name: 'Rent, Nov 12' });
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Late fee waived');
    await user.keyboard('{Escape}');
    const asking = await screen.findByRole('dialog', { name: 'Discard your changes?' });
    // Keep editing (where the focus starts) leaves the form as it was
    expect(within(asking).getByRole('button', { name: 'Keep editing' })).toHaveFocus();
    await user.click(within(asking).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Discard your changes?' })).toBeNull());
    expect(within(dialog).getByLabelText('Note (optional)')).toHaveValue('Late fee waived');
    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(store.writes).toHaveLength(0);
  });
});

describe('changes to data changed elsewhere', () => {
  it('say so in a toast', async () => {
    const { user, core } = await startBudget({ items: [monthly('rent', 'Rent', 12, 50_000)] });
    // Deleted on another device, the page not yet told
    core.call('apply_docs', { docs: [{ docId: 'item~rent', json: null, schema: 1 }] });
    await user.click(screen.getByRole('button', { name: 'Mark Rent paid' }));
    expect(await screen.findByText("That bill isn't there any more (deleted on another device?)")).toBeInTheDocument();
  });

  it('say so on the bills page too', async () => {
    const { user, core } = await startBudget({ items: [monthly('rent', 'Rent', 12, 50_000)] });
    await user.click(screen.getByRole('button', { name: 'Bills' }));
    core.call('apply_docs', { docs: [{ docId: 'item~rent', json: null, schema: 1 }] });
    await user.click(screen.getByRole('button', { name: 'Archive Rent' }));
    expect(await screen.findByText("That bill isn't there any more (deleted on another device?)")).toBeInTheDocument();
  });

  it('refuse an edit to a bill deleted meanwhile, instead of bringing it back', async () => {
    const { user, core, store } = await startBudget({ items: [monthly('rent', 'Rent', 12, 50_000)] });
    await user.click(screen.getByRole('button', { name: 'Bills' }));
    await user.click(screen.getByRole('button', { name: 'Edit Rent' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Rent' });
    await user.type(within(dialog).getByLabelText('Name'), '!');
    core.call('apply_docs', { docs: [{ docId: 'item~rent', json: null, schema: 1 }] });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText("That bill isn't there any more (deleted on another device?)")
    ).toBeInTheDocument();
    expect(store.writes).toHaveLength(0);
  });
});

describe('undo', () => {
  it('doesn’t take back a later change with the one it undoes', async () => {
    const { user, store } = await startBudget({ items: [monthly('rent', 'Rent', 12, 50_000)] });
    await user.click(screen.getByRole('button', { name: 'Mark Rent paid' }));
    expect(await screen.findByText('Rent marked paid')).toBeInTheDocument();
    // A note added on another device, after it was marked paid here
    const paid = JSON.parse(store.docs.get('occ~2026-11-12~rent')!.json);
    store.putDoc('occ~2026-11-12~rent', JSON.stringify({ ...paid, note: 'Receipt 42' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText("It was changed again since, so it can't be undone.")).toBeInTheDocument();
    expect(JSON.parse(store.docs.get('occ~2026-11-12~rent')!.json).note).toBe('Receipt 42');
  });
});

describe('a bill deleted on another device', () => {
  it('closes its history instead of stopping the app', async () => {
    const { user, store } = await startBudget({ items: [monthly('rent', 'Rent', 12, 50_000)] });
    await user.click(screen.getByRole('button', { name: 'Bills' }));
    await user.click(screen.getByRole('button', { name: "Rent's history" }));
    expect(screen.getByRole('dialog', { name: 'Rent' })).toBeInTheDocument();
    store.putDoc('item~rent', null);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('No bills yet')).toBeInTheDocument();
  });

  it('says so when deleting it here is refused, and closes the question', async () => {
    const { user, core } = await startBudget({ items: [monthly('rent', 'Rent', 12, 50_000, { archived: true })] });
    await user.click(screen.getByRole('button', { name: 'Bills' }));
    await user.click(screen.getByRole('button', { name: 'Delete Rent' }));
    // Deleted elsewhere, the page not yet told
    core.call('apply_docs', { docs: [{ docId: 'item~rent', json: null, schema: 1 }] });
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete Rent?' })).getByRole('button', { name: 'Delete' })
    );
    expect(await screen.findByText("That bill isn't there any more (deleted on another device?)")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('an error while showing a page', () => {
  it('is said, with a way to try again, instead of a blank window', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let broken = true;
    const Page = () => {
      if (broken) throw new Error('The page broke');
      return <p>Back again</p>;
    };
    const user = (await import('@testing-library/user-event')).default.setup();
    render(
      <ErrorBoundary>
        <Page />
      </ErrorBoundary>
    );
    expect(screen.getByRole('heading', { name: 'BudgetMint ran into a problem' })).toBeInTheDocument();
    expect(screen.getByText('The page broke')).toBeInTheDocument();
    broken = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Back again')).toBeInTheDocument();
    quiet.mockRestore();
  });

  it('offers a reload instead when core itself stopped', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Page = () => {
      throw new CoreStopped();
    };
    const user = (await import('@testing-library/user-event')).default.setup();
    const reload = vi.fn();
    const { unmount } = render(
      <ErrorBoundary reload={reload}>
        <Page />
      </ErrorBoundary>
    );
    expect(screen.getByText(/Reload to start it again: what you saved is still saved/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalled();
    unmount();
    // Without one given, the page's own (jsdom only says it can't navigate)
    render(
      <ErrorBoundary>
        <Page />
      </ErrorBoundary>
    );
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    quiet.mockRestore();
  });
});

describe('the pages’ other buttons and states', () => {
  it('opens the balance and a first bill from the overview', async () => {
    const { user } = await startBudget();
    await user.click(screen.getByRole('button', { name: 'Update balance' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Add your first bill' }));
    expect(screen.getByRole('dialog', { name: 'Add bill' })).toBeInTheDocument();
  });

  it('edits a one-off bill without a reminder, and a weekly-withdrawal plan', async () => {
    const once = item({
      id: 'fix',
      kind: 'bill',
      name: 'Repair',
      schedule: [{ from: '2026-10-05', until: null, repeat: { every: 'once' }, amountCents: 4_000, weekends: 'keep' }],
    });
    const { user, store } = await startBudget({
      items: [once],
      settings: { taskmint: { policy: { kind: 'weekly', weekday: 2, hour: 8 } } },
    });
    await user.click(screen.getByRole('button', { name: 'Bills' }));
    await user.click(screen.getByRole('button', { name: 'Edit Repair' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Repair' });
    expect(within(dialog).getByRole('switch', { name: 'Remind me' })).not.toBeChecked();
    await user.type(within(dialog).getByLabelText('Name'), '!');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(JSON.parse(store.docs.get('item~fix')!.json).name).toBe('Repair!'));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const taskmint = screen.getByRole('heading', { name: 'TaskMint' }).closest('.MuiPaper-root') as HTMLElement;
    expect(within(taskmint).getByLabelText('On')).toHaveTextContent('Wednesday');
    expect(within(taskmint).getByLabelText('At')).toHaveTextContent('8 AM');
    // Not an amount yet: kept as typed, and nothing saved
    await user.type(screen.getByLabelText('Low balance mark'), '.');
    fireEvent.blur(screen.getByLabelText('Low balance mark'));
    expect(screen.getByLabelText('Low balance mark')).toHaveValue('.');
    expect(JSON.parse(store.docs.get('settings~account')!.json).lowBalanceCents).toBeUndefined();
  });

  it('says who’s signed in with Google (or without an email)', async () => {
    const { store } = await startBudget();
    store.setUser({ uid: 'cal', email: null, providers: ['google.com'] });
    await (await import('@testing-library/user-event')).default
      .setup()
      .click(await screen.findByRole('button', { name: 'Settings' }));
    expect(screen.getByText(/Signed in as/)).toHaveTextContent('Signed in as you with Google.');
  });

  it('starts without a balance from onboarding', async () => {
    const { user, store } = await startBudget({ settings: null });
    await user.click(screen.getByRole('button', { name: 'Start without a balance' }));
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(JSON.parse(store.docs.get('settings~account')!.json).balance).toBeNull();
  });

  it('shows a short day in the sidebar’s collapsed foot', async () => {
    const { user } = await startBudget({ settings: { balance: { cents: -500, asOf: '2026-11-09' } } });
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('img', { name: /Balance today -\$5\.00/ })).toHaveTextContent('-$5');
  });

  it('charts the forecast, with a recorded withdrawal and a low day', async () => {
    const { user } = await startBudget({
      items: [monthly('rent', 'Rent', 12, 95_000)],
      settings: { balance: { cents: 100_000, asOf: '2026-11-09' }, lowBalanceCents: 10_000 },
      forecast: forecastDoc({
        asOfMs: TEST_NOW,
        cutoff: { takenAtMs: TEST_NOW - 86_400_000, amountCents: 3_000 },
        recentWithdrawals: [{ takenAtMs: TEST_NOW - 86_400_000, amountCents: 3_000 }],
      }),
    });
    await user.click(screen.getByRole('button', { name: 'Forecast' }));
    expect(screen.getByText('TaskMint withdrawal')).toBeInTheDocument();
    // The low days are marked, not only colored
    expect(screen.getAllByTitle('Low').length).toBeGreaterThan(0);
    expect(document.querySelector('.recharts-line')).not.toBeNull();
    expect(axisMoney(12.5)).toBe('$13');
    expect(tooltipMoney(-4)).toEqual(['-$4.00', 'Balance']);
    expect(tooltipDay('2026-11-30')).toBe('Mon, Nov 30');
  });
});

describe('the last branches', () => {
  it('say a write was refused, and an undo too', async () => {
    const { user, store } = await startBudget({ items: [monthly('rent', 'Rent', 12, 50_000)] });
    vi.mocked(store.write)
      .mockRejectedValueOnce({ code: 'permission-denied' })
      .mockRejectedValueOnce({ code: 'permission-denied' });
    await user.click(screen.getByRole('button', { name: 'Mark Rent paid' }));
    expect(await screen.findByText('The cloud refused that change. Sign out and in again.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(screen.getAllByText('The cloud refused that change. Sign out and in again.')).toHaveLength(2)
    );
  });

  it('show a note alone, a late bill’s next date, and an emptied amount setting as none', async () => {
    const { user, store } = await startBudget({
      items: [monthly('rent', 'Rent', 12, 50_000), monthly('water', 'Water', 9, 1_000)],
      overrides: [override({ itemId: 'rent', date: '2026-11-12', status: { state: 'open' }, note: 'Call first' })],
      settings: { balance: { cents: 1, asOf: '2026-11-08' }, taskmint: { minWithdrawalCents: 500 } },
    });
    expect(screen.getByText('Call first')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bills' }));
    // Water, unpaid since the 9th
    expect(screen.getByText('Overdue: Yesterday')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const minimum = screen.getByLabelText('Wait until there’s at least');
    await user.clear(minimum);
    fireEvent.blur(minimum);
    await waitFor(() =>
      expect(JSON.parse(store.docs.get('settings~account')!.json).taskmint.minWithdrawalCents).toBe(0)
    );
  });

  it('chart the forecast on a phone, without a low mark, and label a plain bill', async () => {
    const { setPhoneViewport } = await import('./setup/viewport');
    setPhoneViewport();
    const { user } = await startBudget({ items: [monthly('rent', 'Rent', 12, 50_000)] });
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    await user.click(await screen.findByRole('button', { name: 'Forecast' }));
    const days = await screen.findByRole('region', { name: 'Day by day' });
    expect(within(days).getAllByText('Rent').length).toBeGreaterThan(0);
    expect(document.querySelector('.recharts-reference-line')).not.toBeNull();
  });

  it('mark income received, and show it so in the forecast', async () => {
    const pay = item({
      id: 'pay',
      kind: 'income',
      name: 'Paycheck',
      schedule: [{ from: '2026-11-12', until: null, repeat: { every: 'once' }, amountCents: 20_000, weekends: 'keep' }],
    });
    const { user } = await startBudget({ items: [pay] });
    await user.click(screen.getByRole('button', { name: 'Mark Paycheck received' }));
    expect(await screen.findByText('Paycheck marked received')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Forecast' }));
    expect(screen.getByText('Paycheck (received)')).toBeInTheDocument();
  });

  it('reads a day in light mode, and an expected withdrawal in its dialog', async () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <DayCell
          day={day({ withdrawalCents: 100 })}
          isToday={false}
          tabbable={false}
          onOpen={vi.fn()}
          onFocusDay={vi.fn()}
        />
      </ThemeProvider>
    );
    expect(screen.getByRole('button', { name: /TaskMint withdrawal \$1\.00/ })).toBeInTheDocument();
    render(
      <DayDialog
        day={day({ withdrawalCents: 100, withdrawalProjected: true })}
        today="2026-11-10"
        onStep={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('TaskMint withdrawal (expected)')).toBeInTheDocument();
  });
});

describe('a calendar day', () => {
  it('reads in dark mode, a low balance in its own colour', () => {
    render(
      <ThemeProvider theme={createAppTheme('dark')}>
        <DayCell
          day={day({
            withdrawalCents: 500,
            withdrawalProjected: true,
            withdrawalUncertainCents: 100,
            closingCents: 50,
            low: true,
          })}
          isToday
          tabbable
          onOpen={vi.fn()}
          onFocusDay={vi.fn()}
        />
      </ThemeProvider>
    );
    expect(
      screen.getByRole('button', { name: /TaskMint withdrawal expected \$5\.00; balance \$0\.50, low/ })
    ).toBeInTheDocument();
  });

  it('shows a recorded withdrawal and a short end in its dialog', () => {
    render(
      <DayDialog
        day={day({ withdrawalCents: 500, closingCents: -1, short: true })}
        today="2026-11-10"
        onStep={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('TaskMint withdrawal')).toBeInTheDocument();
    expect(screen.getByText('Balance at the end of the day: -$0.01')).toBeInTheDocument();
  });

  it('shows the balance on a quiet day without one', () => {
    render(<DayDialog day={day({})} today="2026-11-10" onStep={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Nothing due.')).toBeInTheDocument();
    expect(override).toBeDefined();
  });
});

describe('the pieces', () => {
  it('need their providers and shell', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useNavigation())).toThrow('useNavigation must be used within a NavigationProvider');
    expect(() => renderHook(() => useBudget())).toThrow('useBudget must be used within a BudgetProvider');
    setShell(null as never);
    expect(() => getShell()).toThrow('No shell: startClient sets it');
    vi.restoreAllMocks();
  });

  it('word errors that aren’t Errors, and other bits copied from TaskMint', () => {
    expect(cloudErrorMessage('plain words')).toBe('plain words');
    expect(cloudErrorMessage({ code: 'resource-exhausted' })).toMatch(/limit for today is used up/);
    // Reading words where there are some, and the usual ones elsewhere
    expect(cloudErrorMessage({ code: 'unavailable' }, { reading: true })).toBe(
      'Can’t reach the cloud. Check the connection and try again.'
    );
    expect(cloudErrorMessage({ code: 'unauthenticated' }, { reading: true })).toBe(
      'Your sign-in has run out. Sign out and in again.'
    );
    expect(cloudErrorMessage({ code: 'nope' }, { reading: true })).toBe('[object Object]');
    expect(formatDateTime(new Date(2026, 10, 30, 9, 5))).toMatch(/2026/);
    render(
      <PageContainer>
        <EmptyState plain icon={<span />} title="Nothing" description="Here" />
      </PageContainer>
    );
    expect(screen.getByText('Nothing')).toBeInTheDocument();
  });

  it('deletes an account it isn’t reading, and drops a late error from an earlier user', async () => {
    const store = createFakeStore();
    const session = new BudgetSession(store, testCore(), 'desk', null, { historyDays: 400, clock: () => TEST_NOW });
    session.stop();
    session.start();
    store.setUser(cal());
    await waitFor(() => expect(session.getView().phase).toBe('ready'));
    const [, , onError] = vi.mocked(store.watchAccount).mock.calls.at(-1)!;
    // Older than the 400 days read, and another account's epoch: neither reaches this one
    store.putDoc('occ~2020-01-01~old', '{}');
    store.setEpoch('someone-else', 4);
    store.failListen(new Error('gone'));
    expect(session.getView().phase).toBe('error');
    await session.deleteAccount();
    expect(store.deleteAll).not.toHaveBeenCalled();
    expect(store.deleteUser).toHaveBeenCalled();
    // Signed out since: the old watch's error changes nothing
    onError(new Error('late'));
    expect(session.getView()).toMatchObject({ phase: 'signedOut', error: null });
  });
});
