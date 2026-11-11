import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignInForm, type SignInActions } from '../SignInForm';

function actions(changes: Partial<SignInActions> = {}): SignInActions {
  return {
    signIn: vi.fn(async () => undefined),
    signUp: vi.fn(async () => undefined),
    resetPassword: vi.fn(async () => undefined),
    signInWithGoogle: vi.fn(async () => undefined),
    canUseGoogle: true,
    ...changes,
  };
}

describe('signing in', () => {
  it('makes an account, and goes back to signing in', async () => {
    const engine = actions();
    render(<SignInForm engine={engine} />);
    const user = userEvent.setup();
    expect(screen.getByText(/Use the account you use for TaskMint/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create an account' }));
    await user.type(screen.getByLabelText('Email'), ' new@example.com ');
    await user.type(screen.getByLabelText('Password'), 'secret1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(engine.signUp).toHaveBeenCalledWith('new@example.com', 'secret1');
    await user.click(screen.getByRole('button', { name: 'I have an account' }));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('sends a reset link, and says what went wrong', async () => {
    const engine = actions({ signIn: vi.fn(async () => Promise.reject({ code: 'auth/invalid-credential' })) });
    render(<SignInForm engine={engine} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'cal@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('That email and password don’t match an account.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(engine.resetPassword).toHaveBeenCalledWith('cal@example.com');
    expect(
      await screen.findByText('If cal@example.com has an account, a reset link is on its way.')
    ).toBeInTheDocument();
  });

  it('signs in with Google, and says when it was closed', async () => {
    const engine = actions({
      signInWithGoogle: vi.fn(async () => Promise.reject({ code: 'auth/popup-closed-by-user' })),
    });
    render(<SignInForm engine={engine} intro="Hello" />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByText('Google sign-in was closed before it finished.')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
