import { describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { BudgetSession, SESSION_OPTIONS } from '../session';
import { cal, createFakeStore, TEST_NOW, testCore, type FakeStore } from '../../testing';
import type { CloudUser } from '../types';
import { forecastDoc, item, TODAY } from '../../__tests__/setup/budget';

const RENT = item({
  id: 'rent',
  kind: 'bill',
  name: 'Rent',
  schedule: [
    {
      from: '2026-12-01',
      until: null,
      repeat: { every: 'months', n: 1, day: 1 },
      amountCents: 120_000,
      weekends: 'keep',
    },
  ],
});

function started(store: FakeStore = createFakeStore(), google: (() => Promise<string | null>) | null = null) {
  const core = testCore();
  const session = new BudgetSession(store, core, 'desk', google, {
    historyDays: 400,
    clock: () => TEST_NOW,
    restart: vi.fn(),
  });
  session.start();
  return { store, core, session };
}

async function signedIn(store: FakeStore = createFakeStore()) {
  const found = started(store);
  store.setUser(cal());
  await waitFor(() => expect(found.session.getView().phase).toBe('ready'));
  return found;
}

describe('the session', () => {
  it('waits signed out, and passes signing in, up and out to Firebase', async () => {
    const { store, session } = started();
    expect(session.getView()).toMatchObject({ phase: 'signedOut', user: null, version: 1 });
    expect(session.canUseGoogle).toBe(false);
    await session.signIn('cal@example.com', 'pw');
    expect(store.signIn).toHaveBeenCalledWith('cal@example.com', 'pw');
    await session.signUp('dee@example.com', 'pw');
    await session.resetPassword('cal@example.com');
    expect(store.resetPassword).toHaveBeenCalledWith('cal@example.com');
    await session.signOut();
    expect(session.getView().phase).toBe('signedOut');

    const google = started(createFakeStore(), async () => 'token');
    expect(google.session.canUseGoogle).toBe(true);
    await google.session.signInWithGoogle();
    expect(google.store.signInWithGoogle).toHaveBeenCalledWith('token');
    await google.session.signInToTaskMintWithGoogle();
    expect(google.store.signInToTaskMintWithGoogle).toHaveBeenCalledWith('token');
    expect(SESSION_OPTIONS.historyDays).toBe(400);
  });

  it('erases this device’s copy of the data when the account signs out, then starts the app over', async () => {
    const restart = vi.fn();
    const store = createFakeStore();
    const session = new BudgetSession(store, testCore(), 'desk', null, {
      historyDays: 400,
      clock: () => TEST_NOW,
      restart,
    });
    session.start();
    store.setUser(cal());
    await waitFor(() => expect(session.getView().phase).toBe('ready'));
    expect(store.clearDevice).not.toHaveBeenCalled();

    // Signed out here, in another tab, or by deleting the account: the same
    await session.signOut();
    expect(session.getView().phase).toBe('signedOut');
    expect(store.clearDevice).toHaveBeenCalledOnce();
    await waitFor(() => expect(restart).toHaveBeenCalledOnce());
    // In the app: the page loads again
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    SESSION_OPTIONS.restart();
    expect(reload).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it('starts the account’s data on its first epoch and reads it in', async () => {
    const store = createFakeStore();
    store.putDoc('item~rent', JSON.stringify(RENT));
    const { core, session } = started(store);
    const seen = vi.fn();
    const unsubscribe = session.subscribe(seen);
    store.setUser(cal());
    expect(session.getView().phase).toBe('starting');
    await waitFor(() => expect(session.getView().phase).toBe('ready'));
    expect(store.createAccount).toHaveBeenCalledWith('cal');
    // Occurrences from 400 days back
    // The account's epoch, and the occurrences from a year and a bit back
    expect(vi.mocked(store.listen).mock.calls[0].slice(1, 3)).toEqual([1, '2025-10-06']);
    expect(core.call('get_items')[0].item.id).toBe('rent');
    expect(seen).toHaveBeenCalled();
    unsubscribe();
  });

  it('says when it’s offline, saving, or holding a newer BudgetMint’s documents', async () => {
    const store = createFakeStore();
    store.offline = true;
    const { session, core } = await signedIn(store);
    expect(session.getView().offline).toBe(true);
    store.putDoc('item~later', '{}', 9);
    expect(session.getView().held).toBe(1);
    const planned = core.call('save_item', {
      item: {
        ...RENT,
        category: null,
        autopay: false,
        reminder: null,
        archived: false,
        note: null,
        varies: false,
        saveUp: false,
      },
    });
    await session.write(planned.writes);
    expect(store.writes[0]).toMatchObject({ uid: 'cal', meta: { deviceId: 'desk', epoch: 1 } });
    expect(session.getView().saving).toBe(true);
    // Its echo from the server
    store.offline = false;
    store.putDoc('item~rent', store.docs.get('item~rent')!.json);
    store.putDoc('settings~account', null);
    store.putDoc('occ~2026-12-01~rent', null);
    store.putDoc('account~savings', null);
    expect(session.getView()).toMatchObject({ offline: false, saving: false });
  });

  it('writes an undo into core at once, and says why a write failed', async () => {
    const { store, session, core } = await signedIn();
    await session.write([]);
    expect(store.write).not.toHaveBeenCalled();
    vi.mocked(store.write).mockRejectedValueOnce({ code: 'permission-denied' });
    const docs = [{ docId: 'item~rent', kind: 'item', json: JSON.stringify(RENT), schema: 1 }];
    await expect(session.write(docs)).rejects.toThrow('The cloud refused that change. Sign out and in again.');
    // Core has it all the same (Firestore's listener puts it back as the server has it)
    expect(core.call('get_items')).toHaveLength(1);
  });

  it('refuses to write signed out', async () => {
    const { session } = started();
    await expect(session.write([])).rejects.toThrow('Sign in to save changes.');
  });

  it('reads TaskMint’s forecast, and takes a refusal to read it as none', async () => {
    const store = createFakeStore();
    store.publishForecast(forecastDoc({ asOfMs: TEST_NOW, carried: { actualCents: 500 } }));
    const { session, core } = await signedIn(store);
    expect(session.getView().taskmint).toMatchObject({ state: 'ready', appVersion: '4.2.0' });
    expect(core.call('get_overview').nextWithdrawal?.totalCents).toBe(500);
    store.failForecast({ code: 'permission-denied' });
    expect(session.getView().taskmint.state).toBe('missing');
    store.publishForecast(null);
    expect(session.getView().taskmint.state).toBe('missing');
  });

  it('reads the forecast of whoever is signed in to TaskMint, and none while nobody is', async () => {
    const store = createFakeStore();
    store.publishForecast(forecastDoc({ asOfMs: TEST_NOW }));
    const { session } = await signedIn(store);
    expect(session.getView().taskmintUser).toEqual(cal());
    expect(vi.mocked(store.watchForecast).mock.calls.at(-1)![0]).toBe('cal');

    // Signed out of TaskMint alone: no forecast, and BudgetMint goes on
    await session.signOutOfTaskMint();
    expect(session.getView()).toMatchObject({ phase: 'ready', taskmintUser: null, taskmint: { state: 'missing' } });
    // TaskMint's account needn't be BudgetMint's uid
    await session.signInToTaskMint('dee@example.com', 'pw');
    expect(store.signInToTaskMint).toHaveBeenCalledWith('dee@example.com', 'pw');
    expect(vi.mocked(store.watchForecast).mock.calls.at(-1)![0]).toBe('dee');
    expect(session.getView().taskmint.state).toBe('ready');
  });

  it('waits for TaskMint’s sign-in to say who it is before reading a forecast', async () => {
    const store = createFakeStore();
    let tell: (user: CloudUser | null) => void = () => undefined;
    vi.mocked(store.onTaskMint).mockImplementationOnce(listener => {
      tell = listener;
      return () => undefined;
    });
    const { session } = await signedIn(store);
    expect(session.getView().taskmint.state).toBe('checking');
    expect(store.watchForecast).not.toHaveBeenCalled();
    tell(null);
    expect(session.getView().taskmint.state).toBe('missing');
  });

  it('starts over quietly after deleting the data here, and says so when it was deleted elsewhere', async () => {
    const store = createFakeStore();
    store.putDoc('item~rent', JSON.stringify(RENT));
    const { session, core } = await signedIn(store);
    await session.deleteData();
    await waitFor(() => expect(session.getView().phase).toBe('ready'));
    expect(session.getView().resetElsewhere).toBe(false);
    expect(core.call('get_items')).toEqual([]);
    expect(vi.mocked(store.listen)).toHaveBeenCalledTimes(2);

    // Another device: epoch 3
    store.putDoc('item~rent', JSON.stringify(RENT));
    store.setEpoch('cal', 3);
    await waitFor(() => expect(session.getView().resetElsewhere).toBe(true));
    session.dismissReset();
    expect(session.getView().resetElsewhere).toBe(false);
    // The same epoch again: nothing to do
    store.setEpoch('cal', 3);
    expect(vi.mocked(store.listen)).toHaveBeenCalledTimes(3);
    // Gone altogether (deleted by hand): starts again
    store.setEpoch('cal', null);
    await waitFor(() => expect(vi.mocked(store.listen)).toHaveBeenCalledTimes(4));
  });

  it('says why deleting the data failed, and keeps going', async () => {
    const { store, session } = await signedIn();
    vi.mocked(store.deleteAll).mockRejectedValueOnce({ code: 'unavailable' });
    await expect(session.deleteData()).rejects.toThrow('Can’t reach the cloud.');
    expect(session.getView().phase).toBe('ready');
  });

  it('deletes the account once Firebase would, and says why when it won’t', async () => {
    const { store, session } = await signedIn();
    // Signed in too long ago for Firebase to delete the account: nothing is deleted
    vi.mocked(store.signedInRecently).mockResolvedValueOnce(false);
    await expect(session.deleteAccount()).rejects.toThrow(
      'Sign out and in again, then delete the account. Nothing was deleted.'
    );
    expect(store.deleteAll).not.toHaveBeenCalled();
    expect(store.deleteUser).not.toHaveBeenCalled();
    // Why the check itself failed
    vi.mocked(store.signedInRecently).mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    await expect(session.deleteAccount()).rejects.toThrow('Can’t reach Firebase.');

    // Refused all the same
    vi.mocked(store.deleteUser).mockRejectedValueOnce({ code: 'auth/requires-recent-login' });
    await expect(session.deleteAccount()).rejects.toThrow('Sign in again first, then try once more.');
    await waitFor(() => expect(session.getView().phase).toBe('ready'));
    await session.deleteAccount();
    expect(store.deleteAll).toHaveBeenCalledTimes(2);
    expect(session.getView().phase).toBe('signedOut');
  });

  it('deletes nothing while offline (the cloud’s answer would never come)', async () => {
    const { store, session } = await signedIn();
    store.offline = true;
    store.putDoc('item~rent', JSON.stringify(RENT));
    await waitFor(() => expect(session.getView().offline).toBe(true));
    const offline = 'You’re offline. Connect, then delete it.';
    await expect(session.deleteData()).rejects.toThrow(offline);
    await expect(session.deleteAccount()).rejects.toThrow(offline);
    expect(store.deleteAll).not.toHaveBeenCalled();
    expect(store.signedInRecently).not.toHaveBeenCalled();
  });

  it('says when the data can’t be read, and tries again', async () => {
    const { store, session } = await signedIn();
    store.failListen({ code: 'permission-denied' });
    expect(session.getView()).toMatchObject({
      phase: 'error',
      error: 'The cloud won’t let this account read its data. Sign out and in again.',
    });
    // A late answer for the failed attempt changes nothing
    store.failListen(new Error('again'));
    await session.retry();
    await waitFor(() => expect(session.getView().phase).toBe('ready'));
  });

  it('says when the account can’t be reached, and drops what a sign-out overtook', async () => {
    const store = createFakeStore();
    const { session } = started(store);
    vi.mocked(store.account).mockRejectedValueOnce(new Error('offline'));
    store.setUser(cal());
    await waitFor(() => expect(session.getView()).toMatchObject({ phase: 'error', error: 'offline' }));

    let answer: (epoch: number | null) => void = () => undefined;
    vi.mocked(store.account).mockImplementationOnce(() => new Promise(resolve => (answer = resolve)));
    store.setUser(cal());
    store.setUser(null);
    answer(1);
    await waitFor(() => expect(session.getView().phase).toBe('signedOut'));
    expect(vi.mocked(store.listen)).not.toHaveBeenCalled();

    // An epoch watch that fails
    store.setUser(cal());
    await waitFor(() => expect(session.getView().phase).toBe('ready'));
    const [, , onError] = vi.mocked(store.watchAccount).mock.calls.at(-1)!;
    onError(new Error('watch failed'));
    expect(session.getView()).toMatchObject({ phase: 'error', error: 'watch failed' });
  });

  it('stops listening when stopped', async () => {
    const { store, session } = await signedIn();
    session.stop();
    store.putDoc('item~rent', JSON.stringify(RENT));
    store.setUser(null);
    expect(session.getView().phase).toBe('ready');
    expect(TODAY).toBe('2026-11-10');
  });
});
