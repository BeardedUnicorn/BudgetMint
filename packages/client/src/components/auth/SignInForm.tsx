// Adapted from TaskMint packages/client/src/components/pages/settings/CloudSyncSection.tsx (SignInForm) @ 1623bee.
/**
 * Signing in: email and password (signing in, making an account, or a reset
 * link), and Google where the build can. BudgetMint needs an account: its
 * data is the cloud's, and TaskMint's withdrawals come with the same one.
 */

import { FormEvent, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import { Google as GoogleIcon } from '@mui/icons-material';
import { cloudErrorMessage } from '../../cloud/errors';

type FormMode = 'signIn' | 'signUp' | 'reset';

const FORM_TITLES: Record<FormMode, string> = {
  signIn: 'Sign in',
  signUp: 'Create account',
  reset: 'Send reset link',
};

/** What signing in needs: the session. */
export interface SignInActions {
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  readonly canUseGoogle: boolean;
}

const INTRO =
  'Your bills and balance, on all your devices. Use the account you use for TaskMint to see your withdrawals ahead.';

/** Email and password: signing in, making an account, or a reset link. And Google, where the build can. */
export function SignInForm({ engine, intro = INTRO }: { engine: SignInActions; intro?: string }) {
  const [mode, setMode] = useState<FormMode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const google = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await engine.signInWithGoogle();
    } catch (error) {
      setProblem(cloudErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (next: FormMode) => {
    setMode(next);
    setProblem(null);
    setNotice(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      if (mode === 'reset') {
        await engine.resetPassword(email.trim());
        setNotice(`If ${email.trim()} has an account, a reset link is on its way.`);
        setMode('signIn');
      } else {
        await (mode === 'signIn' ? engine.signIn : engine.signUp)(email.trim(), password);
      }
    } catch (error) {
      setProblem(cloudErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box component="form" onSubmit={submit} noValidate sx={{ maxWidth: 420 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {intro}
      </Typography>
      {notice && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {notice}
        </Alert>
      )}
      {problem && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {problem}
        </Alert>
      )}
      <Stack spacing={2}>
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={event => setEmail(event.target.value)}
          size="small"
        />
        {mode !== 'reset' && (
          <TextField
            label="Password"
            type="password"
            autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
            value={password}
            onChange={event => setPassword(event.target.value)}
            size="small"
          />
        )}
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          <Button
            type="submit"
            variant="contained"
            disabled={busy}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {FORM_TITLES[mode]}
          </Button>
          {mode === 'signIn' ? (
            <>
              <Button onClick={() => switchTo('signUp')}>Create an account</Button>
              <Button onClick={() => switchTo('reset')}>Forgot password?</Button>
            </>
          ) : (
            <Button onClick={() => switchTo('signIn')}>I have an account</Button>
          )}
        </Stack>
        {engine.canUseGoogle && mode !== 'reset' && (
          <Box>
            <Button variant="outlined" startIcon={<GoogleIcon />} disabled={busy} onClick={() => void google()}>
              Continue with Google
            </Button>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
