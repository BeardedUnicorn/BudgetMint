import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import type { Reminder } from '@budgetmint/contracts';
import { item, monthly, startBudget } from '../../__tests__/setup/budget';
import { createFakeShell } from '../../testing';
import { shortcutView, viewShortcut, modifierLabel, isMacPlatform } from '../useKeyboardShortcuts';
import { reminderText, scheduled } from '../useReminders';
import { useSettings } from '../useSettingsChange';
import { useTick } from '../../data/BudgetContext';

const reminder = (changes: Partial<Reminder>): Reminder => ({
  key: 'rent~2026-12-01~3',
  id: 7,
  atMs: 1,
  kind: 'bill',
  itemId: 'rent',
  name: 'Rent',
  due: '2026-12-01',
  amountCents: 120_000,
  leadDays: 3,
  autopay: false,
  short: false,
  ...changes,
});

afterEach(() => vi.useRealTimers());

describe('keyboard shortcuts', () => {
  const press = (key: string, changes: Partial<KeyboardEvent> = {}) =>
    ({
      key,
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
      ...changes,
    }) as KeyboardEvent;

  it('open the pages by number, and Settings with ⌘, outside a browser', () => {
    expect(shortcutView(press('1'), true, false)).toBe('overview');
    expect(shortcutView(press('6'), true, false)).toBe('settings');
    expect(shortcutView(press('7'), true, false)).toBeNull();
    expect(shortcutView(press('0'), true, false)).toBeNull();
    expect(shortcutView(press(','), true, false)).toBe('settings');
    expect(shortcutView(press(','), true, true)).toBeNull();
    expect(shortcutView(press('x'), true, false)).toBeNull();
    // Ctrl elsewhere, and nothing with other modifiers or a held key
    expect(shortcutView(press('2', { metaKey: false, ctrlKey: true }), false, false)).toBe('bills');
    expect(shortcutView(press('2'), false, false)).toBeNull();
    expect(shortcutView(press('2', { shiftKey: true }), true, false)).toBeNull();
    expect(shortcutView(press('2', { repeat: true }), true, false)).toBeNull();
    expect(viewShortcut('calendar', true)).toBe('⌘4');
    expect(viewShortcut('calendar', false)).toBe('Ctrl+4');
    expect(modifierLabel(false)).toBe('Ctrl+');
    expect(typeof isMacPlatform()).toBe('boolean');
  });

  it('move between pages, but not behind a dialog', async () => {
    const mac = isMacPlatform();
    const { user } = await startBudget();
    const key = (k: string) => fireEvent.keyDown(window, { key: k, metaKey: mac, ctrlKey: !mac });
    key('3');
    expect(screen.getByRole('heading', { name: 'Income', level: 1 })).toBeInTheDocument();
    key('6');
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    key('1');
    expect(screen.getByRole('heading', { name: 'Settings', level: 1, hidden: true })).toBeInTheDocument();
  });
});

describe('reminders', () => {
  it('are worded for bills, income and the balance', () => {
    expect(reminderText(reminder({}))).toEqual({ title: 'Rent is due in 3 days', body: '$1,200.00, Tue, Dec 1.' });
    expect(reminderText(reminder({ leadDays: 0, autopay: true }))).toEqual({
      title: 'Rent is due today',
      body: '$1,200.00 goes out on autopay, Tue, Dec 1.',
    });
    expect(reminderText(reminder({ kind: 'income', name: 'Pay', leadDays: 1 }))).toEqual({
      title: 'Pay comes in tomorrow',
      body: '$1,200.00, Tue, Dec 1.',
    });
    expect(reminderText(reminder({ kind: 'lowBalance', amountCents: 800 })).title).toBe('Your balance gets low');
    expect(reminderText(reminder({ kind: 'lowBalance', amountCents: -800, short: true }))).toEqual({
      title: 'Your balance goes below zero',
      body: 'It’s -$8.00 on Tue, Dec 1.',
    });
    expect(scheduled([reminder({})])).toEqual([
      { id: 7, atMs: 1, title: 'Rent is due in 3 days', body: '$1,200.00, Tue, Dec 1.' },
    ]);
  });

  it('are handed to the shell, and taken back when turned off; a failure is only logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const shell = createFakeShell();
    vi.mocked(shell.platform.notifications.schedule).mockRejectedValueOnce(new Error('no'));
    const { user } = await startBudget({
      shell,
      items: [monthly('rent', 'Rent', 15, 50_000, { reminder: { leadDays: [1] } })],
    });
    await waitFor(() => expect(warn).toHaveBeenCalledWith('Failed to schedule reminders:', expect.any(Error)));
    const schedule = vi.mocked(shell.platform.notifications.schedule);
    expect(schedule.mock.calls[0][0]).toEqual([
      expect.objectContaining({ title: 'Rent is due tomorrow', body: '$500.00, Sun, Nov 15.' }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('switch', { name: 'Remind me on this device' }));
    await waitFor(() => expect(schedule).toHaveBeenLastCalledWith([]));
    warn.mockRestore();
  });
});

describe('the tray', () => {
  it('logs a failure, and does without a tray', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const shell = createFakeShell();
    vi.mocked(shell.platform.tray.setStatus).mockRejectedValueOnce(new Error('no tray'));
    await startBudget({
      shell,
      items: [
        item({
          id: 'x',
          kind: 'income',
          name: 'X',
          schedule: [{ from: '2026-11-12', until: null, repeat: { every: 'once' }, amountCents: 1 }],
        }),
      ],
    });
    await waitFor(() => expect(warn).toHaveBeenCalledWith('Failed to update the tray:', expect.any(Error)));
    expect(shell.platform.tray.setStatus).toHaveBeenCalledWith([
      'Today: $1,000.00',
      'Lowest ahead: $1,000.00 on Tue, Nov 10',
    ]);
    warn.mockRestore();
    await startBudget({ shell: createFakeShell({ without: ['tray', 'systemBars', 'splashScreen'] }) });
  });

  it('says when the balance goes short', async () => {
    const shell = createFakeShell();
    await startBudget({ shell, items: [monthly('rent', 'Rent', 12, 150_000)] });
    expect(vi.mocked(shell.platform.tray.setStatus).mock.lastCall![0].at(-1)).toBe('Short: -$2,000.00 on Sat, Dec 12');
  });
});

describe('settings changes', () => {
  it('say when the rules refuse one', async () => {
    const { session, core } = await startBudget();
    const { BudgetProvider } = await import('../../data/BudgetContext');
    const { NotificationProvider } = await import('../../contexts/NotificationContext');
    const { result } = renderHook(() => useSettings(), {
      wrapper: ({ children }) => (
        <NotificationProvider>
          <BudgetProvider session={session} core={core}>
            {children}
          </BudgetProvider>
        </NotificationProvider>
      ),
    });
    act(() => result.current[1](settings => ({ ...settings, horizonDays: 5 })));
    expect(await screen.findByText('Look 14 to 366 days ahead')).toBeInTheDocument();
  });
});

describe('the clock’s tick', () => {
  it('moves on each interval', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useTick(1000));
    expect(result.current).toBe(0);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(2);
    unmount();
  });
});
