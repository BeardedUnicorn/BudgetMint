/** The desktop's menu bar and tray items that the app does (shell.platform.menu). */

import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { createFakeShell } from '../testing';
import { startBudget } from './setup/budget';

const page = (name: string) => screen.getByRole('heading', { name, level: 1, hidden: true });
const noDialog = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

async function withMenu() {
  const shell = createFakeShell();
  const started = await startBudget({ shell });
  const click = (id: string) => act(() => shell.clickMenu(id));
  return { ...started, shell, click };
}

describe('the menu bar', () => {
  it('has the budget’s items greyed out until the budget is open, and again once signed out', async () => {
    const { shell, session } = await withMenu();
    expect(shell.platform.menu.setBudgetOpen).toHaveBeenLastCalledWith(true);
    await session.signOut();
    await waitFor(() => expect(shell.platform.menu.setBudgetOpen).toHaveBeenLastCalledWith(false));
  });

  it('opens the pages, adds bills and income, and opens the balance', async () => {
    const { click, user } = await withMenu();
    click('go-calendar');
    expect(page('Calendar')).toBeInTheDocument();
    click('settings');
    expect(page('Settings')).toBeInTheDocument();

    click('new-bill');
    expect(await screen.findByRole('dialog', { name: 'Add bill' })).toBeInTheDocument();
    expect(page('Bills')).toBeInTheDocument();
    // Behind a dialog, as the shortcuts, nothing happens
    click('go-reports');
    expect(page('Bills')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await noDialog();

    click('new-income');
    expect(await screen.findByRole('dialog', { name: 'Add income' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await noDialog();

    click('update-balance');
    expect(await screen.findByRole('dialog', { name: 'Your balance' })).toBeInTheDocument();
    expect(page('Overview')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await noDialog();

    // Not one of the app's: the shell does it, or nobody does
    click('quit');
    expect(page('Overview')).toBeInTheDocument();
  });

  it('opens Your data to import a statement, and saves the backup or the spreadsheet', async () => {
    const { click, shell } = await withMenu();
    click('import-statement');
    expect(page('Settings')).toBeInTheDocument();
    await waitFor(() =>
      expect(document.getElementById('settings-data')!.scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
    );

    click('download-backup');
    await waitFor(() =>
      expect(shell.platform.saveFile).toHaveBeenLastCalledWith(
        expect.stringMatching(/\.json$/),
        expect.any(String),
        'application/json'
      )
    );
    click('download-spreadsheet');
    await waitFor(() =>
      expect(shell.platform.saveFile).toHaveBeenLastCalledWith(
        expect.stringMatching(/\.csv$/),
        expect.any(String),
        'text/csv'
      )
    );
    expect(shell.platform.saveFile).toHaveBeenCalledTimes(2);
  });

  it('lists the shortcuts, collapses the sidebar, opens About and asks to sign out', async () => {
    const { click, user } = await withMenu();
    click('shortcuts');
    const list = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(list).getByText('Add income')).toBeInTheDocument();
    expect(within(list).getByText('Update your balance')).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Close' }));
    await noDialog();

    click('toggle-sidebar');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    click('toggle-sidebar');
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();

    click('about');
    await user.click(
      within(await screen.findByRole('dialog', { name: 'About BudgetMint' })).getByRole('button', {
        name: 'Close',
      })
    );
    await noDialog();

    click('sign-out');
    expect(await screen.findByRole('dialog', { name: 'Sign out of BudgetMint?' })).toBeInTheDocument();
  });
});
