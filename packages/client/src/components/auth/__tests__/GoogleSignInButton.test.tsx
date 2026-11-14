// Copied from TaskMint packages/client/src/components/cloud/__tests__/GoogleSignInButton.test.tsx @ 5b818b6.
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material';
import { createAppTheme, type ColorMode } from '../../../theme';
import { GoogleSignInButton } from '../GoogleSignInButton';

function shown(mode: ColorMode, disabled = false) {
  const onClick = vi.fn();
  render(
    <ThemeProvider theme={createAppTheme(mode)}>
      <form onSubmit={() => onClick('submitted')}>
        <GoogleSignInButton disabled={disabled} onClick={onClick} />
      </form>
    </ThemeProvider>
  );
  return { onClick, button: screen.getByRole('button', { name: 'Continue with Google' }) };
}

describe('GoogleSignInButton', () => {
  it("is Google's light button in the light theme, with the colour G, and doesn't submit its form", async () => {
    const { onClick, button } = shown('light');
    expect(button).toHaveStyle({
      backgroundColor: '#FFFFFF',
      color: '#1F1F1F',
      borderColor: '#747775',
      height: '40px',
      fontWeight: '500',
    });
    expect(button).toHaveAttribute('type', 'button');
    const fills = [...button.querySelectorAll('path')].map(path => path.getAttribute('fill'));
    expect(fills).toEqual(['#E94235', '#4285F4', '#FBBC04', '#34A853']);

    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalledWith('submitted');
  });

  it("is Google's dark button in the dark theme", () => {
    const { button } = shown('dark');
    expect(button).toHaveStyle({ backgroundColor: '#131314', color: '#E3E3E3', borderColor: '#8E918F' });
  });

  it('can be disabled', () => {
    expect(shown('light', true).button).toBeDisabled();
  });
});
