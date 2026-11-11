// Adapted from TaskMint packages/client/src/components/ui/display/__tests__/Wordmark.test.tsx @ 1623bee.
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ThemeProvider } from '@mui/material';
import { createAppTheme } from '../../../../theme';
import { Wordmark } from '../Wordmark';

describe('Wordmark', () => {
  it('shows the logo at the height asked for', () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <Wordmark height={28} />
      </ThemeProvider>
    );

    const logo = screen.getByRole('img', { name: 'BudgetMint' });
    expect(logo).toHaveAttribute('src', '/budgetmint-logo.png');
    expect(logo).toHaveStyle({ height: '28px' });
  });

  it('switches to the light-text logo on a dark theme', () => {
    render(
      <ThemeProvider theme={createAppTheme('dark')}>
        <Wordmark height={28} />
      </ThemeProvider>
    );

    expect(screen.getByRole('img', { name: 'BudgetMint' })).toHaveAttribute('src', '/budgetmint-logo-dark.png');
  });
});
