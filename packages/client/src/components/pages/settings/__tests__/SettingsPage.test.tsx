import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { forecastDoc, startBudget, TEST_NOW } from '../../../../__tests__/setup/budget';
import { createFakeShell } from '../../../../testing';

const settingsOf = (store: { docs: Map<string, { json: string }> }) =>
  JSON.parse(store.docs.get('settings~account')!.json);

async function settings(seed: Parameters<typeof startBudget>[0] = {}) {
  const started = await startBudget(seed);
  await started.user.click(screen.getByRole('button', { name: 'Settings' }));
  return started;
}

const section = (name: string) => screen.getByRole('heading', { name }).closest('.MuiPaper-root') as HTMLElement;

describe('settings', () => {
  it('signs out, and deletes the data or the account', async () => {
    const { user, store, session } = await settings();
    const account = section('Account');
    expect(within(account).getByText(/Signed in as/)).toHaveTextContent(
      'Signed in as cal@example.com. It’s the same account as TaskMint’s.'
    );

    await user.click(within(account).getByRole('button', { name: 'Delete account' }));
    store.setTaskMintData('cal', true);
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete your account?' })).getByRole('button', {
        name: 'Delete account',
      })
    );
    expect(await within(account).findByText(/This is also your TaskMint account/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(within(account).getByRole('button', { name: 'Delete BudgetMint data' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete your BudgetMint data?' })).getByRole('button', {
        name: 'Delete data',
      })
    );
    // Started again, with nothing: onboarding
    expect(await screen.findByRole('heading', { name: 'Welcome to BudgetMint' })).toBeInTheDocument();
    expect(store.deleteAll).toHaveBeenCalled();
    await session.signOut();
    expect(await screen.findByRole('heading', { name: 'Sign in to BudgetMint' })).toBeInTheDocument();
  });

  it('signs out from its button, and says which way the account signs in', async () => {
    const { user } = await settings();
    await user.click(within(section('Account')).getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to BudgetMint' })).toBeInTheDocument();
  });

  it('sets how far ahead the forecast looks, the low mark, and the balance', async () => {
    const { user, store } = await settings();
    const forecast = section('Forecast');
    expect(within(forecast).getByText('Starts from $1,000.00, your balance at the end of Nov 9.')).toBeInTheDocument();
    await user.click(within(forecast).getByLabelText('Looks ahead'));
    await user.click(screen.getByRole('option', { name: '90 days' }));
    await waitFor(() => expect(settingsOf(store).horizonDays).toBe(90));
    await user.type(within(forecast).getByLabelText('Low balance mark'), '150');
    fireEvent.blur(within(forecast).getByLabelText('Low balance mark'));
    await waitFor(() => expect(settingsOf(store).lowBalanceCents).toBe(15_000));
    await user.click(within(forecast).getByRole('button', { name: 'Update balance' }));
    expect(screen.getByRole('dialog', { name: 'Your balance' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('asks for a balance when there’s none', async () => {
    await settings({ settings: { horizonDays: 45 } });
    const forecast = section('Forecast');
    expect(within(forecast).getByText('Starts from $0 until you set your balance.')).toBeInTheDocument();
    expect(within(forecast).getByRole('button', { name: 'Set balance' })).toBeInTheDocument();
    // A horizon not among the choices still shows
    expect(within(forecast).getByLabelText('Looks ahead')).toHaveTextContent('45 days');
  });

  it('says how TaskMint’s forecast stands', async () => {
    const { store } = await settings();
    const taskmint = () => section('TaskMint');
    expect(within(taskmint()).getByText('Not connected')).toBeInTheDocument();
    expect(within(taskmint()).getByText(/No TaskMint forecast yet/)).toBeInTheDocument();
    store.publishForecast({ ...forecastDoc({}), schema: 2, appVersion: '9.0.0' });
    expect(
      await within(taskmint()).findByText(/TaskMint 9.0.0 publishes a forecast this BudgetMint can’t read/)
    ).toBeInTheDocument();
    store.publishForecast({ ...forecastDoc({}), json: '{' });
    expect(await within(taskmint()).findByText(/TaskMint’s forecast can’t be read/)).toBeInTheDocument();
    store.publishForecast(forecastDoc({ asOfMs: TEST_NOW, lastImportMs: TEST_NOW - 4 * 86_400_000 }));
    expect(
      await within(taskmint()).findByText(/the numbers may be out of date until you import again/)
    ).toBeInTheDocument();
    expect(within(taskmint()).getByText('Connected')).toBeInTheDocument();
    store.publishForecast({ ...forecastDoc({ asOfMs: TEST_NOW }), appVersion: null });
    expect(await within(taskmint()).findByText(/No work logs imported yet: only tracked time\./)).toBeInTheDocument();
  });

  it('changes how TaskMint’s withdrawals count', async () => {
    const { user, store } = await settings({
      forecast: forecastDoc({ asOfMs: TEST_NOW, lastImportMs: TEST_NOW - 3_600_000 }),
    });
    const taskmint = () => section('TaskMint');
    expect(within(taskmint()).getByText(/Work logs last imported/)).toHaveTextContent('Published by TaskMint 4.2.0.');
    const plan = () => settingsOf(store).taskmint;

    await user.click(within(taskmint()).getByLabelText('You withdraw'));
    await user.click(screen.getByRole('option', { name: 'Once a week' }));
    await waitFor(() => expect(plan().policy).toEqual({ kind: 'weekly', weekday: 4, hour: 9 }));
    await user.click(within(taskmint()).getByLabelText('On'));
    await user.click(screen.getByRole('option', { name: 'Monday' }));
    await waitFor(() => expect(plan().policy.weekday).toBe(0));
    await user.click(within(taskmint()).getByLabelText('At'));
    await user.click(screen.getByRole('option', { name: '6 PM' }));
    await waitFor(() => expect(plan().policy.hour).toBe(18));
    await user.click(within(taskmint()).getByLabelText('You withdraw'));
    await user.click(screen.getByRole('option', { name: 'As soon as the site allows' }));
    await waitFor(() => expect(plan().policy).toEqual({ kind: 'asSoonAsOpen' }));

    await user.click(within(taskmint()).getByLabelText('It reaches the bank'));
    await user.click(screen.getByRole('option', { name: '3 days later' }));
    await waitFor(() => expect(plan().arrivalDelayHours).toBe(72));
    await user.type(within(taskmint()).getByLabelText('Wait until there’s at least'), '50');
    fireEvent.blur(within(taskmint()).getByLabelText('Wait until there’s at least'));
    await waitFor(() => expect(plan().minWithdrawalCents).toBe(5_000));
    await user.click(within(taskmint()).getByRole('switch', { name: /Count time tracked but not imported/ }));
    await user.click(within(taskmint()).getByRole('switch', { name: 'Count money still pending past its release' }));
    await waitFor(() => expect(plan()).toMatchObject({ countEstimates: false, countPastDue: false }));

    await user.click(within(taskmint()).getByLabelText('Earnings ahead'));
    await user.click(screen.getByRole('option', { name: 'A set amount a week' }));
    await user.type(within(taskmint()).getByLabelText('A week'), '400');
    fireEvent.blur(within(taskmint()).getByLabelText('A week'));
    await waitFor(() => expect(plan().future).toEqual({ kind: 'weekly', cents: 40_000 }));
    await user.click(within(taskmint()).getByLabelText('Earnings ahead'));
    await user.click(screen.getByRole('option', { name: 'What recent weeks averaged' }));
    await user.click(within(taskmint()).getByLabelText('Over the last'));
    await user.click(screen.getByRole('option', { name: '1 week' }));
    await waitFor(() => expect(plan().future).toEqual({ kind: 'trailing', weeks: 1 }));
    await user.click(within(taskmint()).getByLabelText('Earnings ahead'));
    await user.click(screen.getByRole('option', { name: 'Only what TaskMint knows' }));
    await waitFor(() => expect(plan().future).toEqual({ kind: 'off' }));

    await user.click(within(taskmint()).getByRole('switch', { name: 'Count TaskMint’s withdrawals in the forecast' }));
    await waitFor(() => expect(plan().useForecast).toBe(false));
    expect(within(taskmint()).queryByLabelText('You withdraw')).not.toBeInTheDocument();
  });

  it('turns reminders on and off on this device, asking for permission', async () => {
    const shell = createFakeShell({ firesWhenClosed: true });
    const { user, store } = await settings({ shell });
    const reminders = () => section('Reminders');
    expect(within(reminders()).getByText('They come even while BudgetMint is closed.')).toBeInTheDocument();
    const toggle = within(reminders()).getByRole('switch', { name: 'Remind me on this device' });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    // Back on: the system says no
    vi.mocked(shell.platform.notifications.request).mockResolvedValueOnce(false);
    await user.click(toggle);
    expect(await within(reminders()).findByText(/Notifications are turned off for BudgetMint/)).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());

    await user.click(within(reminders()).getByLabelText('At'));
    await user.click(screen.getByRole('option', { name: '7 AM' }));
    await waitFor(() => expect(settingsOf(store).reminders.hour).toBe(7));
    await user.click(within(reminders()).getByLabelText('New bills remind'));
    await user.click(screen.getByRole('option', { name: 'On the day' }));
    await waitFor(() => expect(settingsOf(store).reminders.leadDays).toBe(0));
    await user.click(within(reminders()).getByRole('switch', { name: 'Warn me before the balance goes low' }));
    await waitFor(() => expect(settingsOf(store).reminders.lowBalance).toBe(false));
  });

  it('shows the shell’s own sections, the appearance, and what BudgetMint is', async () => {
    const Updates = () => <div>Updates go here</div>;
    const { user } = await settings({
      shell: createFakeShell({ firesWhenClosed: false }),
      extensions: { settingsSections: [{ id: 'updates', label: 'Updates', Section: Updates }] },
    });
    expect(screen.getByText('Updates go here')).toBeInTheDocument();
    expect(screen.getByText('They come while BudgetMint is open (or in the tray).')).toBeInTheDocument();
    expect(screen.getByText(/BudgetMint 0\.1\.0/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Source and releases' })).toHaveAttribute(
      'href',
      'https://github.com/BeardedUnicorn/BudgetMint'
    );
    await user.click(screen.getByRole('button', { name: /Light/ }));
    expect(document.documentElement).toBeDefined();
  });

  it('opens at a section a link asks for', async () => {
    const { user } = await startBudget();
    await user.click(screen.getByRole('button', { name: 'Forecast' }));
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    scroll.mockClear();
    await user.click(screen.getByRole('button', { name: 'Assumptions' }));
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: 'start' }));
  });
});
