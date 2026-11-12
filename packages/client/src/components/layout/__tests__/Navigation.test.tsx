/** Moving around the frame: home from the sidebar's name, and Back. */

import { describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { startBudget } from '../../../__tests__/setup/budget';

const pageHeading = (name: string) => screen.getByRole('heading', { level: 1, name });

describe('the frame', () => {
  it('goes home to the Overview from the name at the top of the sidebar', async () => {
    const { user } = await startBudget();
    await user.click(screen.getByRole('button', { name: 'Reports' }));
    await user.click(screen.getByRole('button', { name: 'BudgetMint home' }));
    expect(pageHeading('Overview')).toBeInTheDocument();
  });

  it('closes a dialog on Back before leaving the page', async () => {
    const { user } = await startBudget();
    await user.click(screen.getByRole('button', { name: 'Bills' }));
    await user.click(screen.getAllByRole('button', { name: 'Add bill' })[0]);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(pageHeading('Bills')).toBeInTheDocument();

    act(() => window.history.back());
    await waitFor(() => expect(pageHeading('Overview')).toBeInTheDocument());
  });
});
