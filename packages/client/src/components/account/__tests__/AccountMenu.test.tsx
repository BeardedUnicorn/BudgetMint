import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { cal } from '../../../testing';
import { startBudget } from '../../../__tests__/setup/budget';
import { setPhoneViewport } from '../../../__tests__/setup/viewport';

const account = () => screen.getByRole('button', { name: 'Account: cal@example.com' });

describe('the account menu', () => {
  it('says who’s signed in, and opens their settings, About, or signing out', async () => {
    const { user } = await startBudget();
    expect(account()).toHaveTextContent('cal@example.com');

    await user.click(account());
    const menu = await screen.findByRole('menu');
    expect(menu).toHaveTextContent('Signed in as');
    await user.click(within(menu).getByRole('menuitem', { name: 'Account settings' }));
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect(document.getElementById('settings-account')!.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    // Opened at a section from the page itself: it isn't scrolled back up over it
    await user.click(account());
    await user.click(await screen.findByRole('menuitem', { name: 'Account settings' }));
    expect(screen.getByRole('main').scrollTo).not.toHaveBeenCalled();

    await user.click(account());
    await user.click(await screen.findByRole('menuitem', { name: 'About BudgetMint' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'About BudgetMint' })).getByRole('button', {
        name: 'Close',
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(account());
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out…' }));
    expect(await screen.findByRole('dialog', { name: 'Sign out of BudgetMint?' })).toBeInTheDocument();
  });

  it('is the initial alone in a collapsed sidebar, with the email in its tooltip', async () => {
    const { user } = await startBudget();
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(account()).toHaveTextContent(/^C$/);
    await user.hover(account());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('cal@example.com');
    await user.click(account());
    expect(await screen.findByRole('menuitem', { name: 'Sign out…' })).toBeInTheDocument();
    // Escape closes it, having done nothing
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toBeInTheDocument();
  });

  it('closes the phone’s menu once an item is picked', async () => {
    setPhoneViewport();
    const { user } = await startBudget();
    // More, on the bottom bar, slides the sidebar in
    await user.click(within(screen.getByRole('navigation', { name: 'Pages' })).getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('button', { name: 'Account: cal@example.com' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Account settings' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reports' })).not.toBeInTheDocument());
    expect(screen.getAllByRole('heading', { name: 'Settings' }).length).toBeGreaterThan(0);
  });

  it('names an account without an email for what it is', async () => {
    const { store } = await startBudget();
    store.setUser({ ...cal(), email: null });
    expect(await screen.findByRole('button', { name: 'Account: your account' })).toHaveTextContent('?');
  });
});
