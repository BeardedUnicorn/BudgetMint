import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { startBudget } from '../../../__tests__/setup/budget';

describe('the app’s frame', () => {
  it('collapses the sidebar to icons, with today’s balance at its foot', async () => {
    const { user } = await startBudget();
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('img', { name: /Balance today \$1,000\.00/ })).toHaveTextContent('$1,000');
    await user.hover(screen.getByRole('button', { name: 'Bills' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Bills/);
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.getByRole('group', { name: /Balance today/ })).toBeInTheDocument();
  });

  it('says when it’s offline or saving, when data is from a newer BudgetMint, and when it was deleted elsewhere', async () => {
    const { store, session } = await startBudget();
    store.offline = true;
    store.putDoc('item~later', '{}', 9);
    expect(await screen.findByText(/Offline: showing what’s on this device/)).toBeInTheDocument();
    expect(screen.getByText(/Some of your data is from a newer BudgetMint/)).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: /Balance today/ })).getByText('Offline')).toBeInTheDocument();
    store.offline = false;
    store.setEpoch('cal', 7);
    expect(await screen.findByText(/Your BudgetMint data was deleted on another device/)).toBeInTheDocument();
    await (await import('@testing-library/user-event')).default
      .setup()
      .click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByText(/deleted on another device/)).not.toBeInTheDocument();
    await session.write([{ docId: 'item~x', kind: 'item', json: null, schema: 1 }]);
  });

  it('says when some of the data can’t be read, and how much', async () => {
    const { store } = await startBudget();
    store.putDoc('item~broken', '{');
    expect(await screen.findByText(/One of your records can’t be read here, so it’s left out/)).toBeInTheDocument();
    store.putDoc('item~torn', '[');
    expect(await screen.findByText(/2 of your records can’t be read here, so they’re left out/)).toBeInTheDocument();
    store.putDoc('item~broken', null);
    store.putDoc('item~torn', null);
    await waitFor(() => expect(screen.queryByText(/can’t be read here/)).not.toBeInTheDocument());
  });
});
