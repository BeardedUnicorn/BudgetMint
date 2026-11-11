// Adapted from TaskMint apps/desktop/src/__tests__/updates.test.tsx @ 1623bee.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import {
  automaticCheckDue,
  CHECK_INTERVAL_MS,
  lastCheckedAt,
  resetUpdatesForTest,
  sentence,
  UPDATE_PROGRESS,
  updates,
  type AvailableUpdate,
} from '../updates';
import { DUE_CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS, UpdatePrompt } from '../UpdatePrompt';
import { UpdatesSection } from '../settings/UpdatesSection';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const mockInvoke = vi.mocked(invoke);

/** What each shell command answers; a function's result (or rejection) is the reply. */
function answer(replies: Record<string, unknown>) {
  mockInvoke.mockImplementation(async (_dispatch, payload) => {
    const reply = replies[(payload as { command: string }).command];
    return typeof reply === 'function' ? reply() : reply;
  });
}

function sent(command: string) {
  return mockInvoke.mock.calls
    .map(([, payload]) => payload as { command: string; args: Record<string, unknown> })
    .filter(payload => payload.command === command)
    .map(payload => payload.args);
}

const rejects = (reason: string) => () => Promise.reject(reason);

const release: AvailableUpdate = {
  version: '2.3.0',
  currentVersion: '2.2.0',
  notes: '### Added\n\n- Updates from GitHub, with `latest.json`.',
  date: '2026-11-20T10:00:00Z',
};

/** The Tauri events listened for, by name. */
const listening = new Map<string, EventCallback<unknown>>();

/** Sends `payload` as the Rust side would. */
function emit(event: string, payload: unknown) {
  listening.get(event)?.({ event, id: 0, payload });
}

let focused: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetUpdatesForTest();
  listening.clear();
  vi.mocked(listen).mockImplementation(async (event, handler) => {
    listening.set(event, handler as EventCallback<unknown>);
    return () => listening.delete(event);
  });
  focused = true;
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the update store', () => {
  it('says when BudgetMint is up to date, and remembers when it checked', async () => {
    answer({ check_for_update: null });
    expect(lastCheckedAt()).toBeNull();

    await updates.check({ manual: true });

    expect(updates.get().update).toEqual({ status: 'upToDate' });
    expect(lastCheckedAt()).toBeGreaterThan(0);
  });

  it('opens the dialog for a release it finds', async () => {
    answer({ check_for_update: release });
    await updates.check({ manual: true });
    expect(updates.get().update).toEqual({ status: 'available', update: release, open: true });
    // The user asked, so they're looking: no OS notification
    expect(sent('show_notification')).toEqual([]);
  });

  it('shows a failed check the user asked for, and keeps quiet about an automatic one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    answer({ check_for_update: rejects('error sending request') });

    await updates.check({ manual: true });
    expect(updates.get().update).toEqual({ status: 'checkFailed', error: 'Error sending request.' });

    // An automatic check leaves what was there
    answer({ check_for_update: release });
    await updates.check({ manual: true });
    updates.later();
    answer({ check_for_update: rejects('offline') });
    await updates.check({ manual: false });
    expect(updates.get().update).toEqual({ status: 'available', update: release, open: false });
    expect(warn).toHaveBeenCalledWith('Automatic update check failed:', 'offline');
    expect(lastCheckedAt()).not.toBeNull();
  });

  it('checks once at a time, and not while installing', async () => {
    let finish: (value: null) => void = () => undefined;
    answer({ check_for_update: () => new Promise(resolve => (finish = resolve)) });
    const first = updates.check({ manual: true });
    expect(updates.get().update).toEqual({ status: 'checking', manual: true });
    await updates.check({ manual: false });
    finish(null);
    await first;
    expect(sent('check_for_update')).toHaveLength(1);

    answer({ check_for_update: release, install_update: () => new Promise(() => undefined) });
    await updates.check({ manual: true });
    void updates.install();
    await updates.check({ manual: true });
    expect(sent('check_for_update')).toHaveLength(2);
  });

  it("announces a release found while the window isn't in front, once per version", async () => {
    focused = false;
    answer({ check_for_update: release, show_notification: true });

    await updates.check({ manual: false });
    await updates.check({ manual: false });

    expect(sent('show_notification')).toEqual([
      { title: 'BudgetMint 2.3.0 is available', body: 'Open BudgetMint to install it.' },
    ]);

    // In front, there's the dialog
    focused = true;
    answer({ check_for_update: { ...release, version: '2.3.1' } });
    await updates.check({ manual: false });
    expect(sent('show_notification')).toHaveLength(1);
  });

  it('logs a notification that fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    focused = false;
    answer({ check_for_update: release, show_notification: rejects('not allowed') });
    await updates.check({ manual: false });
    await waitFor(() => expect(warn).toHaveBeenCalledWith('Failed to announce the update:', 'not allowed'));
  });

  it('closes the dialog with Later and opens it again with show', async () => {
    updates.later();
    updates.show();
    expect(updates.get().update).toEqual({ status: 'idle' });

    answer({ check_for_update: release });
    await updates.check({ manual: true });
    updates.later();
    expect(updates.get().update).toEqual({ status: 'available', update: release, open: false });
    updates.show();
    expect(updates.get().update).toEqual({ status: 'available', update: release, open: true });
  });

  it('installs with the download’s progress, and can try again after a failure', async () => {
    let fail: (reason: string) => void = () => undefined;
    answer({
      check_for_update: release,
      install_update: () => new Promise((_, reject) => (fail = reject)),
    });
    await updates.install();
    expect(sent('install_update')).toEqual([]);

    await updates.check({ manual: true });
    const installing = updates.install();
    expect(updates.get().update).toEqual({ status: 'installing', update: release, progress: null });

    const progress = { downloaded: 10, total: 100, installing: false };
    act(() => emit(UPDATE_PROGRESS, progress));
    expect(updates.get().update).toEqual({ status: 'installing', update: release, progress });

    fail('signature mismatch');
    await installing;
    expect(updates.get().update).toEqual({ status: 'installFailed', update: release, error: 'Signature mismatch.' });
    // The download's events stop with it
    act(() => emit(UPDATE_PROGRESS, progress));
    expect(updates.get().update.status).toBe('installFailed');

    answer({ install_update: undefined });
    await updates.install();
    expect(sent('install_update')).toHaveLength(2);
    // (A real install restarts the app before it gets here)
    expect(updates.get().update).toEqual({ status: 'installing', update: release, progress: null });
  });

  it('ignores progress that arrives once the install has ended', async () => {
    let finish: () => void = () => undefined;
    answer({ check_for_update: release, install_update: () => new Promise<void>(resolve => (finish = resolve)) });
    await updates.check({ manual: true });
    const installing = updates.install();
    // Ended some other way meanwhile (a test resetting it, say)
    resetUpdatesForTest();
    act(() => emit(UPDATE_PROGRESS, { downloaded: 1, total: 2, installing: false }));
    expect(updates.get().update).toEqual({ status: 'idle' });
    finish();
    await installing;
  });

  it('remembers whether checks run on their own', () => {
    expect(updates.get().autoCheck).toBe(true);
    updates.setAutoCheck(false);
    expect(localStorage.getItem('updateAutoCheck')).toBe('false');
    resetUpdatesForTest();
    expect(updates.get().autoCheck).toBe(false);
  });

  it('works without localStorage, forgetting everything', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    resetUpdatesForTest();
    expect(updates.get().autoCheck).toBe(true);
    updates.setAutoCheck(false);
    expect(updates.get().autoCheck).toBe(false);
    answer({ check_for_update: null });
    await updates.check({ manual: true });
    expect(lastCheckedAt()).toBeNull();
  });

  it('says an automatic check is due a day after the last one, if checks are on', () => {
    const now = 1_800_000_000_000;
    expect(automaticCheckDue(now)).toBe(true);
    localStorage.setItem('updateLastCheckedAt', String(now - CHECK_INTERVAL_MS + 1));
    expect(automaticCheckDue(now)).toBe(false);
    localStorage.setItem('updateLastCheckedAt', String(now - CHECK_INTERVAL_MS));
    expect(automaticCheckDue(now)).toBe(true);
    localStorage.setItem('updateLastCheckedAt', 'garbage');
    expect(lastCheckedAt()).toBeNull();
    updates.setAutoCheck(false);
    expect(automaticCheckDue(now)).toBe(false);
  });
});

describe('the automatic checks', () => {
  /** Runs the prompt's timers `ms` on, with the checks they start finished. */
  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  function setVisibility(state: DocumentVisibilityState) {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.stubEnv('DEV', false);
    answer({ check_for_update: null });
  });

  it('check soon after launch, then daily', async () => {
    const { unmount } = render(<UpdatePrompt />);
    await advance(FIRST_CHECK_DELAY_MS - 1);
    expect(sent('check_for_update')).toHaveLength(0);
    await advance(1);
    expect(sent('check_for_update')).toHaveLength(1);

    // Each hour it looks, but it's not due yet…
    await advance(CHECK_INTERVAL_MS - DUE_CHECK_INTERVAL_MS);
    expect(sent('check_for_update')).toHaveLength(1);
    // …until the first look a day after the last check
    await advance(DUE_CHECK_INTERVAL_MS);
    expect(sent('check_for_update')).toHaveLength(1);
    await advance(DUE_CHECK_INTERVAL_MS);
    expect(sent('check_for_update')).toHaveLength(2);

    unmount();
    await advance(CHECK_INTERVAL_MS * 2);
    expect(sent('check_for_update')).toHaveLength(2);
  });

  it('catch up when the window shows again, once one is due', async () => {
    render(<UpdatePrompt />);
    await advance(FIRST_CHECK_DELAY_MS);
    expect(sent('check_for_update')).toHaveLength(1);

    vi.setSystemTime(Date.now() + CHECK_INTERVAL_MS);
    setVisibility('hidden');
    expect(sent('check_for_update')).toHaveLength(1);
    setVisibility('visible');
    await advance(0);
    expect(sent('check_for_update')).toHaveLength(2);
    setVisibility('visible');
    await advance(0);
    expect(sent('check_for_update')).toHaveLength(2);
  });

  it("don't run when turned off", async () => {
    updates.setAutoCheck(false);
    render(<UpdatePrompt />);
    await advance(CHECK_INTERVAL_MS * 2);
    setVisibility('visible');
    expect(sent('check_for_update')).toHaveLength(0);
  });

  it("don't run in a development build", async () => {
    vi.stubEnv('DEV', true);
    render(<UpdatePrompt />);
    await advance(CHECK_INTERVAL_MS * 2);
    expect(sent('check_for_update')).toHaveLength(0);
  });
});

describe('the update dialog', () => {
  async function found(update: AvailableUpdate = release) {
    answer({ check_for_update: update });
    render(<UpdatePrompt />);
    await act(() => updates.check({ manual: true }));
    return screen.findByRole('dialog', { name: `BudgetMint ${update.version} is available` });
  }

  it("shows nothing until there's an update", () => {
    render(<UpdatePrompt />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks, with the release notes, and Later closes it', async () => {
    const dialog = await found();
    expect(dialog).toHaveTextContent('You have 2.2.0.');
    expect(dialog).toHaveTextContent('Your budget is in the cloud, so nothing is lost.');
    expect(within(dialog).getByRole('heading', { name: "What's new" })).toBeInTheDocument();
    expect(within(dialog).getByText('Added')).toBeInTheDocument();
    expect(within(dialog).getByText('latest.json').tagName).toBe('CODE');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(updates.get().update).toMatchObject({ status: 'available', open: false });
  });

  it('closes on Escape, as Later', async () => {
    const dialog = await found({ ...release, notes: null });
    expect(within(dialog).queryByRole('heading', { name: "What's new" })).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows the download, then the install', async () => {
    const dialog = await found();
    answer({ install_update: () => new Promise(() => undefined) });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download and install' }));

    expect(await within(dialog).findByText('Starting the download…')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Later' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Download and install' })).toBeDisabled();
    // Nothing closes it mid-install
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    act(() => emit(UPDATE_PROGRESS, { downloaded: 4_200_000, total: 12_800_000, installing: false }));
    expect(within(dialog).getByText('Downloading… 4.2 MB of 12.8 MB')).toBeInTheDocument();
    expect(within(dialog).getByRole('progressbar', { name: 'Downloading the update' })).toHaveAttribute(
      'aria-valuenow',
      '33'
    );

    act(() => emit(UPDATE_PROGRESS, { downloaded: 5_000_000, total: null, installing: false }));
    expect(within(dialog).getByText('Downloading… 5.0 MB')).toBeInTheDocument();
    expect(within(dialog).getByRole('progressbar', { name: 'Downloading the update' })).not.toHaveAttribute(
      'aria-valuenow'
    );

    act(() => emit(UPDATE_PROGRESS, { downloaded: 12_800_000, total: 12_800_000, installing: true }));
    expect(within(dialog).getByText("Installing… BudgetMint restarts when it's done.")).toBeInTheDocument();
    expect(within(dialog).getByRole('progressbar', { name: 'Installing the update' })).toBeInTheDocument();
  });

  it('says why an install failed, and can try again or close', async () => {
    const dialog = await found();
    answer({ install_update: rejects('the download was interrupted') });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download and install' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "The update couldn't be installed. The download was interrupted."
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(sent('install_update')).toHaveLength(2));

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('Settings → Updates', () => {
  it('turns automatic checks off and on', () => {
    render(<UpdatesSection />);
    const toggle = screen.getByRole('switch', { name: 'Check for updates automatically' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(updates.get().autoCheck).toBe(false);
  });

  it('checks now, and says BudgetMint is up to date', async () => {
    let finish: (value: null) => void = () => undefined;
    answer({ check_for_update: () => new Promise(resolve => (finish = resolve)) });
    render(<UpdatesSection />);
    expect(screen.queryByText(/up to date/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText('Checking for updates…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
    await act(async () => finish(null));
    expect(screen.getByText('BudgetMint is up to date.')).toBeInTheDocument();
  });

  it('says why a check failed', async () => {
    answer({ check_for_update: rejects('error sending request for url') });
    render(<UpdatesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't check for updates. Error sending request for url."
    );
  });

  it('opens the dialog again for an update put off with Later', async () => {
    answer({ check_for_update: release, install_update: () => new Promise(() => undefined) });
    render(
      <>
        <UpdatesSection />
        <UpdatePrompt />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(screen.getByText('BudgetMint 2.3.0 is available.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Update…' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Download and install' }));
    expect(await screen.findByText('Updating to BudgetMint 2.3.0…')).toBeInTheDocument();
  });
});

describe('a refusal from the Rust side', () => {
  it('reads as a sentence', () => {
    expect(sentence('the release feed is down')).toBe('The release feed is down.');
    expect(sentence('No network!')).toBe('No network!');
  });
});
