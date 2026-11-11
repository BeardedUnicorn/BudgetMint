import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, StartupError } from '../App';
import type { AppExtensions } from '../shell/types';
import { BudgetSession } from '../cloud/session';
import { setShell } from '../shell';
import { cal, createFakeShell, createFakeStore, TEST_NOW, testCore } from '../testing';
import { monthly, startBudget } from './setup/budget';
import { setPhoneViewport } from './setup/viewport';

function unstarted(store = createFakeStore(), extensions: AppExtensions = {}) {
  const shell = createFakeShell();
  setShell(shell);
  const core = testCore();
  const session = new BudgetSession(store, core, 'desk', null, { historyDays: 400, clock: () => TEST_NOW });
  render(<App session={session} core={core} extensions={extensions} />);
  return { store, session, shell };
}

describe('the app', () => {
  it('waits for Firebase, then asks to sign in, and opens once signed in', async () => {
    const { store, session, shell } = unstarted();
    expect(screen.getByRole('status', { name: 'Loading your budget' })).toBeInTheDocument();
    expect(shell.platform.splashScreen.hide).not.toHaveBeenCalled();
    session.start();
    expect(await screen.findByRole('heading', { name: 'Sign in to BudgetMint' })).toBeInTheDocument();
    expect(shell.platform.splashScreen.hide).toHaveBeenCalled();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'cal@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(store.signIn).toHaveBeenCalledWith('cal@example.com', 'secret');
    // A new account: onboarding first
    expect(await screen.findByRole('heading', { name: 'Welcome to BudgetMint' })).toBeInTheDocument();
  });

  it('runs the shell’s background before sign-in too, so an update reaches an app that can’t sign in', async () => {
    const Background = () => <div>shell background</div>;
    const { session } = unstarted(createFakeStore(), { Background });
    session.start();
    expect(await screen.findByRole('heading', { name: 'Sign in to BudgetMint' })).toBeInTheDocument();
    expect(screen.getByText('shell background')).toBeInTheDocument();
  });

  it('says when the account’s data can’t be read, and tries again or signs out', async () => {
    const store = createFakeStore();
    vi.mocked(store.account).mockRejectedValue(new Error('Can’t reach the cloud.'));
    const { session } = unstarted(store);
    session.start();
    store.setUser(cal());
    expect(await screen.findByRole('heading', { name: 'BudgetMint can’t reach your data' })).toBeInTheDocument();
    expect(screen.getByText('Can’t reach the cloud.')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(store.account).toHaveBeenCalledTimes(2);
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to BudgetMint' })).toBeInTheDocument();
  });

  it('onboards with a balance, or without one', async () => {
    const { user, store } = await startBudget({ settings: null });
    expect(screen.getByText(/Not connected yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByText('Enter your balance, or start without one')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Balance'), '2,500');
    expect(screen.getByText('Starting from $2,500.00')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Count TaskMint’s withdrawals' }));
    await user.click(screen.getByRole('switch', { name: 'Count TaskMint’s withdrawals' }));
    await user.click(screen.getByLabelText('They reach the bank'));
    await user.click(screen.getByRole('option', { name: 'Two days later' }));
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    const saved = JSON.parse(store.docs.get('settings~account')!.json);
    expect(saved).toMatchObject({
      balance: { cents: 250_000, asOf: '2026-11-10' },
      taskmint: { arrivalDelayHours: 48 },
    });
  });

  it('onboards without a balance, saying when the date or amount is refused', async () => {
    const { user } = await startBudget({ settings: null });
    await user.type(screen.getByLabelText('Balance'), '10');
    fireEvent.change(screen.getByLabelText('At the end of'), { target: { value: '2030-01-01' } });
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Set the balance as of today or a day before')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Count TaskMint’s withdrawals' }));
    expect(screen.queryByLabelText('They reach the bank')).not.toBeInTheDocument();
  });

  it('shows the next withdrawal while onboarding, once TaskMint is connected', async () => {
    const { forecastDoc } = await import('./setup/budget');
    await startBudget({ settings: null, forecast: forecastDoc({ asOfMs: TEST_NOW, carried: { actualCents: 5_000 } }) });
    expect(screen.getByText('Your next withdrawal: $50.00, in the bank Nov 11.')).toBeInTheDocument();
  });

  it('says TaskMint has nothing to withdraw yet while onboarding', async () => {
    const { forecastDoc } = await import('./setup/budget');
    await startBudget({ settings: null, forecast: forecastDoc({ asOfMs: TEST_NOW }) });
    expect(screen.getByText('Connected: nothing to withdraw yet.')).toBeInTheDocument();
  });

  it('moves between pages from the sidebar, and runs the shell’s background', async () => {
    const Background = () => <div>shell background</div>;
    const { user, shell } = await startBudget({
      items: [monthly('rent', 'Rent', 12, 50_000)],
      extensions: { Background },
    });
    expect(screen.getByText('shell background')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bills' }));
    expect(screen.getByRole('heading', { name: 'Bills' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Income' }));
    expect(screen.getByRole('heading', { name: 'Income' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(screen.getByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Forecast' }));
    expect(screen.getByRole('heading', { name: 'Forecast' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    // The sidebar's foot: today's balance
    expect(screen.getByRole('group', { name: /Balance today \$1,000\.00/ })).toBeInTheDocument();
    expect(shell.platform.tray.setStatus).toHaveBeenCalledWith([
      'Today: $1,000.00',
      'Next: Rent · $500.00 · Thu, Nov 12',
      'Lowest ahead: $0.00 on Sat, Dec 12',
    ]);
  });

  it('opens the sidebar from the top bar on a phone', async () => {
    setPhoneViewport();
    const { user } = await startBudget();
    const topBar = () => screen.getByRole('button', { name: 'Open navigation' }).closest('header')!;
    expect(topBar()).toHaveTextContent('Overview');
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    await user.click(await screen.findByRole('button', { name: 'Bills' }));
    await waitFor(() => expect(topBar()).toHaveTextContent('Bills'));
  });

  it('says when it can’t start, and offers to try again', async () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    render(<StartupError message="Firebase didn’t load" />);
    expect(screen.getByRole('heading', { name: 'BudgetMint can’t start' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
