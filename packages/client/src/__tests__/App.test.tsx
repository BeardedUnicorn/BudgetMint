import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, StartupError } from '../App';
import type { AppExtensions } from '../shell/types';
import { BudgetSession } from '../cloud/session';
import { setShell } from '../shell';
import { cal, createFakeShell, createFakeStore, TEST_NOW, testCore } from '../testing';
import { REMINDERS_ON_KEY } from '../hooks/useReminders';
import { writeLocal } from '../utils/localStore';
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

/** A bill with a reminder: something for notifications to say. */
const reminded = monthly('rent', 'Rent', 12, 50_000, { reminder: { leadDays: [3] } });

describe('the app', () => {
  it('waits for Firebase, then asks to sign in, and opens once signed in', async () => {
    const { store, session, shell } = unstarted();
    expect(screen.getByRole('status', { name: 'Loading your budget' })).toBeInTheDocument();
    expect(shell.platform.splashScreen.hide).not.toHaveBeenCalled();
    session.start();
    expect(await screen.findByRole('heading', { name: 'Sign in to BudgetMint' })).toBeInTheDocument();
    expect(shell.platform.splashScreen.hide).toHaveBeenCalled();
    const user = userEvent.setup();
    // The title says what the form does
    await user.click(screen.getByRole('button', { name: 'Create an account' }));
    expect(screen.getByRole('heading', { name: 'Create your BudgetMint account' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I have an account' }));
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I have an account' }));
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
    // TaskMint's account isn't this one: where to sign in to it
    act(() => store.setTaskMintUser(null));
    expect(screen.getByText(/Not signed in to TaskMint/)).toHaveTextContent('Settings → TaskMint');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Enter your balance, or skip it')).toBeInTheDocument();
    expect(screen.getByLabelText('Balance')).toBeInvalid();
    await waitFor(() => expect(screen.getByLabelText('Balance')).toHaveFocus());
    await user.type(screen.getByLabelText('Balance'), '2,500');
    expect(screen.getByText('Starting from $2,500.00')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Count TaskMint’s withdrawals' }));
    await user.click(screen.getByRole('switch', { name: 'Count TaskMint’s withdrawals' }));
    await user.click(screen.getByLabelText('They reach the bank'));
    await user.click(screen.getByRole('option', { name: '2 days later' }));
    // Enter in the balance goes on, as Next does
    await user.type(screen.getByLabelText('Balance'), '{Enter}');

    // Pay: every 2 weeks unless said otherwise; a name it can't do without
    expect(screen.getByRole('heading', { name: 'Your pay' })).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Enter what each pays, or skip it')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Each pays'), '1820');
    await user.clear(screen.getByLabelText('Name'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Give it a name')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Acme pay');
    await user.click(screen.getByLabelText('Repeats'));
    await user.click(screen.getByRole('option', { name: 'Every week' }));
    await user.click(screen.getByLabelText('Repeats'));
    await user.click(screen.getByRole('option', { name: 'Something else…' }));
    fireEvent.change(screen.getByLabelText('Every how many weeks'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Next payday'), { target: { value: '' } });
    expect(screen.queryByText(/^Starting/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Next payday'), { target: { value: '2026-11-13' } });
    expect(screen.getByText('Starting Fri, Nov 13')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Everyday spending: asked for, or skipped; Back and on again keeps it
    expect(screen.getByRole('heading', { name: 'Everyday spending' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Enter a week’s worth, or skip it')).toBeInTheDocument();
    await user.type(screen.getByLabelText('A week'), '150');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    // Pay is saved already: its amount is empty, not added twice
    expect(screen.getByLabelText('Each pays')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByLabelText('A week')).toHaveValue('150');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // The bills most have: ticked ones need an amount
    expect(screen.getByRole('heading', { name: 'Your regular bills' })).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Rent or mortgage' }));
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByText('Enter the amount')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Rent or mortgage: amount'), '1450');
    await user.click(screen.getAllByLabelText('Due on')[0]);
    await user.click(screen.getByRole('option', { name: 'The 1st' }));
    await user.click(screen.getByRole('checkbox', { name: 'Electric' }));
    expect(screen.getByText('About: it learns from what you pay')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Electric: amount'), '135');
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    const saved = JSON.parse(store.docs.get('settings~account')!.json);
    expect(saved).toMatchObject({
      balance: { cents: 250_000, asOf: '2026-11-10' },
      spendingWeeklyCents: 15_000,
      taskmint: { arrivalDelayHours: 48 },
    });
    const items = [...store.docs.values()].map(doc => JSON.parse(doc.json)).filter(doc => doc.schedule);
    expect(items).toHaveLength(3);
    expect(items.find(doc => doc.name === 'Acme pay')).toMatchObject({
      kind: 'income',
      autopay: true,
      schedule: [{ from: '2026-11-13', repeat: { every: 'weeks', n: 2 } }],
    });
    expect(items.find(doc => doc.name === 'Rent or mortgage')).toMatchObject({
      category: 'Housing',
      schedule: [{ repeat: { every: 'months', n: 1, day: 1 }, amountCents: 145_000 }],
    });
    expect(items.find(doc => doc.name === 'Electric')).toMatchObject({ varies: true, category: 'Utilities' });
  });

  it('lets the wrong account sign out of onboarding, and says when a newer BudgetMint has the settings', async () => {
    const { user, store } = await startBudget({ settings: null });
    expect(screen.getByText(/Signed in as cal@example.com/)).toBeInTheDocument();
    // The settings exist, written by a newer BudgetMint: said, and not started over
    store.putDoc('settings~account', '{}', 9);
    expect(await screen.findByText(/Some of your data is from a newer BudgetMint/)).toBeInTheDocument();
    // Started with nothing but the steps: it ends with the settings, which are refused
    for (const _ of [1, 2, 3]) await user.click(screen.getByRole('button', { name: 'Skip' }));
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText(/A newer BudgetMint changed this/)).toBeInTheDocument();
    expect(store.docs.get('settings~account')).toMatchObject({ json: '{}', schema: 9 });
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to BudgetMint' })).toBeInTheDocument();
  });

  it('says “you” in onboarding for an account without an email', async () => {
    const { store } = await startBudget({ settings: null });
    store.setUser({ uid: 'cal', email: null, providers: ['google.com'] });
    expect(await screen.findByText(/Signed in as you\./)).toBeInTheDocument();
  });

  it('onboards without a balance, saying when the date or amount is refused', async () => {
    const { user } = await startBudget({ settings: null });
    await user.type(screen.getByLabelText('Balance'), '10');
    fireEvent.change(screen.getByLabelText('As of'), { target: { value: '2030-01-01' } });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Set the balance as of today or a day before')).toBeInTheDocument();
    expect(screen.getByLabelText('As of')).toBeInvalid();
    await user.click(screen.getByRole('switch', { name: 'Count TaskMint’s withdrawals' }));
    expect(screen.queryByLabelText('They reach the bank')).not.toBeInTheDocument();
  });

  it('shows the next withdrawal while onboarding, once TaskMint is connected', async () => {
    const { forecastDoc } = await import('./setup/budget');
    await startBudget({ settings: null, forecast: forecastDoc({ asOfMs: TEST_NOW, carried: { actualCents: 5_000 } }) });
    expect(screen.getByText('Your next withdrawal: $50.00, in the bank Nov 11.')).toBeInTheDocument();
  });

  it('says it’s still checking TaskMint while onboarding, until the cloud says', async () => {
    const store = createFakeStore();
    // TaskMint's forecast not heard of yet
    vi.mocked(store.watchForecast).mockImplementation(() => () => undefined);
    store.setUser(cal());
    unstarted(store).session.start();
    expect(await screen.findByText('Checking TaskMint…')).toBeInTheDocument();
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

  it('clears the reminders and the tray when the account signs out', async () => {
    const { session, shell } = await startBudget({
      items: [monthly('rent', 'Rent', 12, 50_000, { reminder: { leadDays: [1] } })],
    });
    await waitFor(() => expect(shell.platform.notifications.schedule).toHaveBeenLastCalledWith([expect.anything()]));
    await session.signOut();
    expect(await screen.findByRole('heading', { name: 'Sign in to BudgetMint' })).toBeInTheDocument();
    // Nothing of the account's is left to show: no reminder later, no balance in the menu bar
    expect(shell.platform.notifications.schedule).toHaveBeenLastCalledWith([]);
    expect(shell.platform.tray.setStatus).toHaveBeenLastCalledWith([]);
  });

  it('only warns when the shell can’t clear them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { session, shell } = await startBudget();
    await waitFor(() => expect(shell.platform.tray.setStatus).toHaveBeenCalled());
    vi.mocked(shell.platform.notifications.schedule).mockRejectedValue(new Error('no scheduler'));
    vi.mocked(shell.platform.tray.setStatus).mockRejectedValue(new Error('no tray'));
    await session.signOut();
    await waitFor(() => expect(warn).toHaveBeenCalledWith('Failed to clear the tray:', expect.any(Error)));
    expect(warn).toHaveBeenCalledWith('Failed to clear reminders:', expect.any(Error));
    warn.mockRestore();
  });

  it('offers to allow notifications in a browser that hasn’t, and names no shortcuts or tray there', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const shell = createFakeShell({ runtime: 'web', without: ['tray', 'autostart'] });
    const granted = vi.fn(async () => false);
    shell.platform.notifications.granted = granted;
    const { user } = await startBudget({ shell, items: [reminded] });
    expect(
      await screen.findByText('Reminders are on, but this browser hasn’t allowed BudgetMint’s notifications.')
    ).toBeInTheDocument();
    expect(shell.platform.notifications.request).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Allow' }));
    expect(shell.platform.notifications.request).toHaveBeenCalledTimes(1);
    // The browser keeps ⌘1–⌘8 for its tabs: no hint of them
    await user.hover(screen.getByRole('button', { name: 'Bills' }));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('They come while BudgetMint is open in a tab.')).toBeInTheDocument();
    expect(screen.queryByText(/⌘|Ctrl\+/)).not.toBeInTheDocument();
    // Collapsed, the page's name still shows on hover
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    await user.hover(screen.getByRole('button', { name: 'Bills' }));
    expect(await screen.findByRole('tooltip', { name: 'Bills' })).toBeInTheDocument();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('asks nothing when notifications are allowed, or reminders are off, and only warns when it can’t tell', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const shell = createFakeShell({ runtime: 'web' });
    const granted = vi.fn(async () => true);
    shell.platform.notifications.granted = granted;
    const first = await startBudget({ shell, items: [reminded] });
    await waitFor(() => expect(granted).toHaveBeenCalled());
    expect(screen.queryByText(/hasn’t allowed/)).not.toBeInTheDocument();
    first.unmount();

    granted.mockRejectedValueOnce(new Error('no answer'));
    const second = await startBudget({ shell, items: [reminded] });
    await waitFor(() => expect(warn).toHaveBeenCalledWith('Failed to ask about notifications:', expect.any(Error)));
    second.unmount();

    granted.mockClear();
    writeLocal(REMINDERS_ON_KEY, false, true);
    await startBudget({ shell, items: [reminded] });
    expect(granted).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('has the phone’s system ask at launch, where reminders come while the app is closed', async () => {
    const shell = createFakeShell({ runtime: 'mobile', firesWhenClosed: true });
    const { store } = await startBudget({ shell });
    // Not before there's something to remind of
    expect(shell.platform.notifications.request).not.toHaveBeenCalled();
    act(() => store.putDoc('item~rent', JSON.stringify(reminded)));
    await waitFor(() => expect(shell.platform.notifications.request).toHaveBeenCalledTimes(1));
    // The desktop needs no asking
    const desk = createFakeShell();
    await startBudget({ shell: desk });
    expect(desk.platform.notifications.request).not.toHaveBeenCalled();
  });

  it('moves between pages from the bottom bar on a phone, with More for the rest, and goes back', async () => {
    setPhoneViewport();
    const { user, store, session } = await startBudget();
    const topBar = () => document.querySelector('header.MuiAppBar-root')!;
    const bar = screen.getByRole('navigation', { name: 'Pages' });
    expect(topBar()).toHaveTextContent('Overview');
    await user.click(within(bar).getByRole('button', { name: 'Bills' }));
    expect(topBar()).toHaveTextContent('Bills');
    // The rest are in the sidebar, slid in
    await user.click(within(bar).getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(topBar()).toHaveTextContent('Settings'));
    // (once the sidebar has gone: until then the page is hidden from screen readers)
    await waitFor(() => expect(within(bar).getByRole('button', { name: 'More' })).toHaveClass('Mui-selected'));
    // Back (the browser's, or Android's gesture) returns to the page before, and the one before that
    act(() => window.history.back());
    await waitFor(() => expect(topBar()).toHaveTextContent('Bills'));
    act(() => window.history.back());
    await waitFor(() => expect(topBar()).toHaveTextContent('Overview'));
    // With the sidebar open, Back closes it and stays on the page
    await user.click(within(bar).getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('button', { name: 'Reports' })).toBeVisible();
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reports' })).toBeNull());
    expect(topBar()).toHaveTextContent('Overview');
    // Whether changes are still on their way (or it's offline) shows in the top bar
    expect(topBar()).not.toHaveTextContent(/Saving|Offline/);
    await act(() => session.write([{ docId: 'item~x', kind: 'item', json: null, schema: 1 }]));
    expect(topBar()).toHaveTextContent('Saving…');
    store.offline = true;
    act(() => store.putDoc('item~y', null));
    expect(topBar()).toHaveTextContent('Offline');
  });

  it('says when it can’t start, and offers to try again', async () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    // The shell's background (the desktop's update check) runs here too
    render(<StartupError message="Firebase didn’t load" extensions={{ Background: () => <div>update check</div> }} />);
    expect(screen.getByRole('heading', { name: 'BudgetMint can’t start' })).toBeInTheDocument();
    expect(screen.getByText('update check')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
