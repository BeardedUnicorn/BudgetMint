import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { forecastDoc, monthly, SETTLED, startBudget, TEST_NOW } from '../../../../__tests__/setup/budget';
import { createFakeShell } from '../../../../testing';
import { APP_VERSION } from '../../../../utils/appVersion';

const settingsOf = (store: { docs: Map<string, { json: string }> }) =>
  JSON.parse(store.docs.get('settings~account')!.json);

async function settings(seed: Parameters<typeof startBudget>[0] = {}) {
  const started = await startBudget(seed);
  await started.user.click(screen.getByRole('button', { name: 'Settings' }));
  return started;
}

const section = (name: string) => screen.getByRole('heading', { name }).closest('.MuiPaper-root') as HTMLElement;

describe('signing out', () => {
  it('asks first while changes are still on their way to the cloud', async () => {
    const { user, store, session } = await settings({ items: [monthly('rent', 'Rent', 1, 120_000)] });
    // A change the cloud hasn't confirmed
    vi.mocked(store.write).mockImplementationOnce(() => new Promise(() => undefined));
    void session.write([{ docId: 'item~rent', kind: 'item', json: null, schema: 1 }]);
    const account = section('Account');
    await user.click(within(account).getByRole('button', { name: 'Sign out' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign out before your changes are saved?' });
    expect(store.signOut).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Sign out anyway' }));
    await waitFor(() => expect(store.signOut).toHaveBeenCalled());
  });

  it('says when signing out fails', async () => {
    const { user, store } = await settings();
    vi.mocked(store.signOut).mockRejectedValueOnce(new Error('No connection'));
    await user.click(within(section('Account')).getByRole('button', { name: 'Sign out' }));
    expect(await within(section('Account')).findByText('No connection')).toBeInTheDocument();
  });
});

describe('currency and weeks', () => {
  it('writes amounts in the chosen currency, and starts weeks on the chosen day', async () => {
    const { user, store } = await settings({ settings: { ...SETTLED } });
    await user.click(screen.getByLabelText('Currency'));
    await user.click(screen.getByRole('option', { name: 'Euro (EUR)' }));
    await waitFor(() => expect(settingsOf(store).currency).toBe('EUR'));
    expect(screen.getByText(/marked Low \(and below €0, Below zero\)/)).toBeInTheDocument();
    await user.click(screen.getByLabelText('Weeks start on'));
    await user.click(screen.getByRole('option', { name: 'Monday' }));
    await waitFor(() => expect(settingsOf(store).weekStartsMonday).toBe(true));
    await user.click(screen.getByLabelText('Weeks start on'));
    await user.click(screen.getByRole('option', { name: 'Sunday' }));
    await waitFor(() => expect(settingsOf(store).weekStartsMonday).toBe(false));
  });

  it('lists a currency chosen elsewhere that isn’t among the usual ones', async () => {
    await settings({ settings: { ...SETTLED, currency: 'ISK' } });
    expect(screen.getByLabelText('Currency')).toHaveTextContent('Icelandic Króna (ISK)');
  });
});

describe('your data', () => {
  it('saves a backup and a spreadsheet the shell’s way, and restores a backup with Undo', async () => {
    const shell = createFakeShell();
    const { user, store } = await settings({ items: [monthly('rent', 'Rent', 1, 120_000)], shell });
    const data = section('Your data');
    await user.click(within(data).getByRole('button', { name: 'Download backup' }));
    await waitFor(() => expect(shell.platform.saveFile).toHaveBeenCalledTimes(1));
    const [name, backup, type] = vi.mocked(shell.platform.saveFile).mock.calls[0];
    expect([name, type]).toEqual(['budgetmint-2026-11-10.json', 'application/json']);
    expect(JSON.parse(backup).items.map((item: { id: string }) => item.id)).toEqual(['rent']);
    await user.click(within(data).getByRole('button', { name: 'Download spreadsheet' }));
    await waitFor(() => expect(shell.platform.saveFile).toHaveBeenCalledTimes(2));
    expect(vi.mocked(shell.platform.saveFile).mock.calls[1][0]).toBe('budgetmint-2026-11-10.csv');
    vi.mocked(shell.platform.saveFile).mockRejectedValueOnce(new Error('disk full'));
    await user.click(within(data).getByRole('button', { name: 'Download backup' }));
    expect(await within(data).findByText('It wasn’t saved: disk full')).toBeInTheDocument();

    // The button asks for the file
    const choose = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    await user.click(within(data).getByRole('button', { name: 'Restore from a backup…' }));
    expect(choose).toHaveBeenCalled();
    choose.mockRestore();
    // Rent deleted since: the backup brings it back, and Undo takes it away again
    store.putDoc('item~rent', null);
    await user.upload(within(data).getByLabelText('Backup file'), new File([backup], 'budget.json'));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Replace your budget with the backup?' })).getByRole('button', {
        name: 'Restore',
      })
    );
    await waitFor(() => expect(store.docs.has('item~rent')).toBe(true));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.docs.has('item~rent')).toBe(false));

    // Not a backup: said, and nothing changes
    await user.upload(within(data).getByLabelText('Backup file'), new File(['{'], 'notes.json'));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }));
    expect(await within(data).findByText("That file isn't a BudgetMint backup")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // None picked: nothing asked
    fireEvent.change(within(data).getByLabelText('Backup file'), { target: { files: [] } });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('downloads them in a browser, and says where to get them when the app can’t save', async () => {
    const createObjectURL = vi.fn(() => 'blob:budget');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { user } = await settings({ shell: createFakeShell({ runtime: 'web', without: ['saveFile'] }) });
    await user.click(within(section('Your data')).getByRole('button', { name: 'Download spreadsheet' }));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:budget');
    click.mockRestore();
  });

  it('says where to get the files when this app can’t save them', async () => {
    await settings({ shell: createFakeShell({ without: ['saveFile'] }) });
    const data = section('Your data');
    expect(within(data).getByText(/This app can’t save files yet/)).toBeInTheDocument();
    expect(within(data).queryByRole('button', { name: 'Download backup' })).not.toBeInTheDocument();
    expect(within(data).getByRole('button', { name: 'Restore from a backup…' })).toBeInTheDocument();
  });
});

describe('settings', () => {
  it('signs out, and deletes the data or the account', async () => {
    const { user, store, session } = await settings();
    const account = section('Account');
    expect(within(account).getByText(/Signed in as/)).toHaveTextContent('Signed in as cal@example.com.');

    // Refused: what Firebase says, and nothing deleted
    await user.click(within(account).getByRole('button', { name: 'Delete account' }));
    vi.mocked(store.signedInRecently).mockResolvedValueOnce(false);
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete your account?' })).getByRole('button', {
        name: 'Delete account',
      })
    );
    expect(await within(account).findByText(/Sign out and in again, then delete the account/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(store.deleteUser).not.toHaveBeenCalled();

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

  it('leaves an amount another device changed as it is, until it’s typed over here', async () => {
    const { user, store } = await startBudget({ settings: { ...SETTLED, lowBalanceCents: 10_000 } });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const low = () => screen.getByLabelText('Low balance mark');
    expect(low()).toHaveValue('100.00');
    // Changed on another device: the field follows, and passing through it writes nothing back
    store.putDoc('settings~account', JSON.stringify({ ...SETTLED, lowBalanceCents: 20_000 }));
    await waitFor(() => expect(low()).toHaveValue('200.00'));
    await user.click(low());
    fireEvent.blur(low());
    expect(JSON.parse(store.docs.get('settings~account')!.json).lowBalanceCents).toBe(20_000);
    // Emptied here: no low mark
    await user.clear(low());
    fireEvent.blur(low());
    await waitFor(() => expect(JSON.parse(store.docs.get('settings~account')!.json).lowBalanceCents).toBe(0));
    expect(low()).toHaveValue('');
  });

  it('sends a test reminder, and says where to look when it doesn’t show', async () => {
    const shell = createFakeShell();
    const { user } = await startBudget({ shell });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Send a test reminder' }));
    expect(shell.platform.notifications.show).toHaveBeenCalledWith(
      'BudgetMint reminders',
      'This is how a reminder looks.'
    );
    expect(await screen.findByText(/^Sent\. If nothing appeared/)).toBeInTheDocument();
    vi.mocked(shell.platform.notifications.show).mockRejectedValueOnce(new Error('blocked'));
    await user.click(screen.getByRole('button', { name: 'Send a test reminder' }));
    expect(await screen.findByText(/^It couldn’t be sent/)).toBeInTheDocument();
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

  it('signs in to TaskMint alone when signing in to BudgetMint didn’t, and out of it', async () => {
    const { user, store } = await settings();
    const taskmint = () => section('TaskMint');
    expect(within(taskmint()).getByText(/Signed in to TaskMint as/)).toHaveTextContent(
      'Signed in to TaskMint as cal@example.com.'
    );
    // The sign-in lapsing (not signed out here) keeps the section, to sign in again
    store.setTaskMintUser(null);
    expect(await within(taskmint()).findByText('Not signed in')).toBeInTheDocument();
    expect(within(taskmint()).getByText(/Not signed in to TaskMint\./)).toBeInTheDocument();
    expect(within(taskmint()).queryByText(/No TaskMint forecast yet/)).not.toBeInTheDocument();
    // TaskMint's accounts are TaskMint's to make, and its passwords to reset
    expect(within(taskmint()).queryByRole('button', { name: 'Create an account' })).not.toBeInTheDocument();
    expect(within(taskmint()).queryByRole('button', { name: 'Forgot password?' })).not.toBeInTheDocument();

    await user.type(within(taskmint()).getByLabelText('Email'), 'dee@example.com');
    await user.type(within(taskmint()).getByLabelText('Password'), 'pw');
    await user.click(within(taskmint()).getByRole('button', { name: 'Sign in' }));
    expect(store.signInToTaskMint).toHaveBeenCalledWith('dee@example.com', 'pw');
    expect(await within(taskmint()).findByText(/Signed in to TaskMint as/)).toHaveTextContent(
      'Signed in to TaskMint as dee@example.com.'
    );
    // Signing out here forgets TaskMint: Settings only offers to connect it again. Firebase
    // says nobody's signed in only after the sign-out has resolved: it's forgotten even so
    vi.mocked(store.signOutOfTaskMint).mockImplementationOnce(async () => {
      setTimeout(() => store.setTaskMintUser(null), 20);
    });
    await user.click(within(taskmint()).getByRole('button', { name: 'Sign out of TaskMint' }));
    expect(store.signOutOfTaskMint).toHaveBeenCalled();
    // (The section is a new one after: looked up each time)
    await waitFor(() => expect(within(taskmint()).getByRole('button', { name: 'Connect TaskMint' })).toBeVisible());
    await user.click(within(taskmint()).getByRole('button', { name: 'Connect TaskMint' }));
    expect(
      within(taskmint()).getByText(/BudgetMint only reads its forecast of what you’ll withdraw/)
    ).toBeInTheDocument();
    store.setTaskMintUser({ uid: 'g', email: null, providers: ['google.com'] });
    // Connected again: the whole section is back (a new one, so it's looked up each time)
    await waitFor(() =>
      expect(within(taskmint()).getByText(/Signed in to TaskMint as/)).toHaveTextContent(
        'Signed in to TaskMint as you with Google.'
      )
    );
  });

  it('says when TaskMint couldn’t be signed out of', async () => {
    const { user, store } = await settings();
    vi.mocked(store.signOutOfTaskMint).mockRejectedValueOnce(new Error('offline'));
    await user.click(within(section('TaskMint')).getByRole('button', { name: 'Sign out of TaskMint' }));
    expect(await screen.findByText('TaskMint couldn’t be signed out of. Try again.')).toBeInTheDocument();
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
    await user.click(within(reminders()).getByRole('switch', { name: 'Warn me before the balance gets low' }));
    await waitFor(() => expect(settingsOf(store).reminders.lowBalance).toBe(false));
  });

  it('opens at login on the desktop, as the system has it, and says when it can’t', async () => {
    const shell = createFakeShell();
    vi.mocked(shell.platform.autostart.isEnabled).mockResolvedValueOnce(true);
    const { user } = await settings({ shell });
    const reminders = () => section('Reminders');
    const toggle = await within(reminders()).findByRole('switch', { name: 'Open BudgetMint at login' });
    await waitFor(() => expect(toggle).toBeChecked());
    await user.click(toggle);
    expect(shell.platform.autostart.setEnabled).toHaveBeenCalledWith(false);
    await waitFor(() => expect(toggle).not.toBeChecked());
    vi.mocked(shell.platform.autostart.setEnabled).mockRejectedValueOnce('The login item couldn’t be added');
    await user.click(toggle);
    expect(
      await within(reminders()).findByText('Couldn’t change opening at login. The login item couldn’t be added')
    ).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
  });

  it('leaves opening at login out where the shell can’t', async () => {
    await settings({ shell: createFakeShell({ without: ['autostart'] }) });
    expect(within(section('Reminders')).queryByRole('switch', { name: 'Open BudgetMint at login' })).toBeNull();
  });

  it('says when the system can’t be asked whether it opens at login', async () => {
    const shell = createFakeShell();
    vi.mocked(shell.platform.autostart.isEnabled).mockRejectedValueOnce('no launcher');
    await settings({ shell });
    expect(
      await within(section('Reminders')).findByText('Can’t tell whether BudgetMint opens at login. no launcher')
    ).toBeInTheDocument();
    expect(within(section('Reminders')).getByRole('switch', { name: 'Open BudgetMint at login' })).toBeDisabled();
  });

  it('shows the shell’s own sections, the appearance, and what BudgetMint is', async () => {
    const Updates = () => <div>Updates go here</div>;
    const { user } = await settings({
      shell: createFakeShell({ firesWhenClosed: false }),
      extensions: { settingsSections: [{ id: 'updates', label: 'Updates', Section: Updates }] },
    });
    expect(screen.getByText('Updates go here')).toBeInTheDocument();
    expect(screen.getByText('They come while BudgetMint is open (or in the tray).')).toBeInTheDocument();
    // Whatever version this is (a release changes it)
    expect(
      screen.getByText(`BudgetMint ${APP_VERSION}: your bills, income and the balance ahead.`)
    ).toBeInTheDocument();
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

describe('privacy', () => {
  it('turns usage statistics off and on where the shell has them', async () => {
    localStorage.clear();
    const shell = createFakeShell();
    const { user } = await settings({ shell });
    const toggle = within(section('Privacy')).getByRole('switch', { name: 'Share usage statistics' });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(shell.platform.analytics.setEnabled).toHaveBeenLastCalledWith(false);
    await user.click(toggle);
    expect(shell.platform.analytics.setEnabled).toHaveBeenLastCalledWith(true);
  });

  it('has no Privacy section where the shell has no analytics (the desktop)', async () => {
    await settings({ shell: createFakeShell({ without: ['analytics'] }) });
    expect(screen.queryByRole('heading', { name: 'Privacy' })).not.toBeInTheDocument();
  });
});
