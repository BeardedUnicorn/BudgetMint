import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
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
    // Typed again, differently: said, and nothing made
    await user.type(screen.getByLabelText('The password again'), 'secret2');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText(/The two passwords aren’t the same/)).toBeInTheDocument();
    expect(engine.signUp).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Show the password' }));
    expect(screen.getByLabelText('The password again')).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide the password' }));
    await user.clear(screen.getByLabelText('The password again'));
    await user.type(screen.getByLabelText('The password again'), 'secret1');
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

  it('can give up on a Google sign-in left in the browser, and try another way', async () => {
    let fail: (error: unknown) => void = () => undefined;
    const engine = actions({ signInWithGoogle: vi.fn(() => new Promise<void>((_, reject) => (fail = reject))) });
    render(<SignInForm engine={engine} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(screen.getByText('Finish signing in in your browser.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    // The abandoned attempt timing out later says nothing
    await act(async () => fail(new Error('Google sign-in timed out. Try again.')));
    expect(screen.queryByText(/timed out/)).not.toBeInTheDocument();
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
