// Adapted from TaskMint packages/client/src/components/pages/settings/CloudSyncSection.tsx (SignInForm) @ 1623bee.
/**
 * Signing in: email and password (signing in, making an account, or a reset
 * link), and Google where the build can. BudgetMint needs an account: its
 * data is the cloud's. Signing in with the same email and password as
 * TaskMint's (or the same Google account) brings TaskMint's withdrawals.
 * Settings uses it for TaskMint alone, without making an account or a reset.
 */

import { FormEvent, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Visibility as ShowIcon, VisibilityOff as HideIcon } from '@mui/icons-material';
import { cloudErrorMessage } from '../../cloud/errors';
import { GoogleSignInButton } from './GoogleSignInButton';

export type FormMode = 'signIn' | 'signUp' | 'reset';

const FORM_TITLES: Record<FormMode, string> = {
  signIn: 'Sign in',
  signUp: 'Create account',
  reset: 'Send reset link',
};

/** What signing in needs: the session. Without `signUp` or `resetPassword`, the form doesn't offer them. */
export interface SignInActions {
  signIn(email: string, password: string): Promise<void>;
  signUp?(email: string, password: string): Promise<void>;
  resetPassword?(email: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  readonly canUseGoogle: boolean;
}

const INTRO =
  'Your bills, income and balance ahead, on all your devices. Using TaskMint too? Sign in with the same account, and its withdrawals count as income.';

/**
 * Email and password: signing in, making an account, or a reset link. And
 * Google, where the build can. `onPhone`: Google's own account sheet asks
 * (Android), not a browser page, so the wait says to choose an account.
 */
export function SignInForm({
  engine,
  intro = INTRO,
  onPhone = false,
  onModeChange,
}: {
  engine: SignInActions;
  intro?: string;
  onPhone?: boolean;
  /** Told when it switches between signing in, making an account and a reset link (the page's title follows). */
  onModeChange?: (mode: FormMode) => void;
}) {
  const [mode, setFormMode] = useState<FormMode>('signIn');
  const setMode = (next: FormMode) => {
    setFormMode(next);
    onModeChange?.(next);
  };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  /** A new account's password, typed again: a typo would lock it out. */
  const [again, setAgain] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** The Google sign-in being waited for (it's finished in the browser, or a phone's account sheet); null when none is. */
  const [googleAttempt, setGoogleAttempt] = useState<number | null>(null);
  const attempts = useRef(0);

  const google = async () => {
    const attempt = ++attempts.current;
    setBusy(true);
    setGoogleAttempt(attempt);
    setProblem(null);
    let problem: string | null = null;
    try {
      await engine.signInWithGoogle();
    } catch (error) {
      problem = cloudErrorMessage(error);
    }
    // Given up on meanwhile: what became of it is no longer of interest
    if (attempts.current !== attempt) return;
    setProblem(problem);
    setGoogleAttempt(null);
    setBusy(false);
  };

  /** Gives up on the sign-in left in the browser (it may never come back), so another way can be tried. */
  const cancelGoogle = () => {
    attempts.current += 1;
    setGoogleAttempt(null);
    setBusy(false);
  };

  const switchTo = (next: FormMode) => {
    setMode(next);
    setProblem(null);
    setNotice(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'signUp' && password !== again) {
      setProblem('The two passwords aren’t the same. Type it again in both.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      if (mode === 'reset') {
        await engine.resetPassword!(email.trim());
        setNotice(`If ${email.trim()} has an account, a reset link is on its way.`);
        setMode('signIn');
      } else {
        await (mode === 'signIn' ? engine.signIn : engine.signUp!)(email.trim(), password);
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
            type={shown ? 'text' : 'password'}
            autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
            value={password}
            onChange={event => setPassword(event.target.value)}
            size="small"
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      edge="end"
                      aria-label={shown ? 'Hide the password' : 'Show the password'}
                      onClick={() => setShown(!shown)}
                    >
                      {shown ? <HideIcon fontSize="small" /> : <ShowIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
        )}
        {mode === 'signUp' && (
          <TextField
            label="The password again"
            type={shown ? 'text' : 'password'}
            autoComplete="new-password"
            value={again}
            onChange={event => setAgain(event.target.value)}
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
              {engine.signUp && (
                <Button disabled={busy} onClick={() => switchTo('signUp')}>
                  Create an account
                </Button>
              )}
              {engine.resetPassword && (
                <Button disabled={busy} onClick={() => switchTo('reset')}>
                  Forgot password?
                </Button>
              )}
            </>
          ) : (
            <Button disabled={busy} onClick={() => switchTo('signIn')}>
              I have an account
            </Button>
          )}
        </Stack>
        {engine.canUseGoogle && mode !== 'reset' && (
          <Box>
            <GoogleSignInButton disabled={busy} onClick={() => void google()} />
            {googleAttempt !== null && (
              <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary" role="status">
                  {onPhone ? 'Choose your Google account.' : 'Finish signing in in your browser.'}
                </Typography>
                <Button size="small" onClick={cancelGoogle}>
                  Cancel
                </Button>
              </Stack>
            )}
          </Box>
        )}
      </Stack>
    </Box>
  );
}
