/**
 * The first time: the balance to start from, and how TaskMint's
 * withdrawals count (shown when TaskMint has published its forecast).
 * Saving the settings is what ends it, so it comes once per account.
 */

import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
  Link,
} from '@mui/material';
import { useBudget, useBudgetChange, useCoreQuery } from '../../data/BudgetContext';
import { formatDay } from '../../utils/dates';
import { formatCents, formatMaybeCents, parseDollars } from '../../utils/money';
import { Wordmark } from '../ui/display/Wordmark';

export function Onboarding() {
  const { session, view } = useBudget();
  const { settings } = useCoreQuery('get_settings');
  const overview = useCoreQuery('get_overview');
  const change = useBudgetChange();
  const [amount, setAmount] = useState('');
  const [asOf, setAsOf] = useState(overview.today);
  const [useTaskMint, setUseTaskMint] = useState(true);
  const [delay, setDelay] = useState(settings.taskmint.arrivalDelayHours);
  const [problem, setProblem] = useState<string | null>(null);
  /** Started with a balance that isn't an amount: said under it, and focus goes to it. */
  const [wrong, setWrong] = useState(false);
  const balanceInput = useRef<HTMLInputElement>(null);
  const connected = view.taskmint.state === 'ready';
  const next = overview.nextWithdrawal;

  const start = (withBalance: boolean) => {
    const cents = parseDollars(amount);
    setWrong(withBalance && cents === null);
    if (withBalance && cents === null) {
      setProblem(null);
      balanceInput.current?.focus();
      return;
    }
    try {
      // The balance first: a refused one stops it all (saving the settings keeps it)
      if (withBalance) change('set_balance', { balance: { cents: cents!, asOf } });
      change('save_settings', {
        settings: {
          ...settings,
          taskmint: { ...settings.taskmint, useForecast: useTaskMint, arrivalDelayHours: delay },
        },
      });
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  return (
    <Box component="main" sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Paper sx={{ width: '100%', maxWidth: 560, p: { xs: 3, sm: 4 } }}>
        <Stack spacing={1} sx={{ mb: 3, alignItems: 'center', textAlign: 'center' }}>
          <Wordmark height={44} />
          <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
            Welcome to BudgetMint
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Two things, and you’re set: what your account holds, and how TaskMint’s money comes in.
          </Typography>
        </Stack>
        {problem && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {problem}
          </Alert>
        )}
        <Stack spacing={3}>
          <Box component="section" aria-labelledby="balance-title">
            <Typography id="balance-title" variant="h6" component="h2" sx={{ mb: 1 }}>
              Your balance
            </Typography>
            <Stack direction="row" spacing={2}>
              <TextField
                label="Balance"
                value={amount}
                onChange={event => setAmount(event.target.value)}
                inputRef={balanceInput}
                error={wrong}
                helperText={wrong ? 'Enter your balance, or start without one' : undefined}
                sx={{ flex: 1 }}
                slotProps={{
                  input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
                  htmlInput: { inputMode: 'decimal' },
                }}
              />
              <TextField
                label="At the end of"
                type="date"
                value={asOf}
                onChange={event => setAsOf(event.target.value)}
                sx={{ flex: 1 }}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: overview.today } }}
              />
            </Stack>
          </Box>
          <Box component="section" aria-labelledby="taskmint-title">
            <Typography id="taskmint-title" variant="h6" component="h2" sx={{ mb: 1 }}>
              TaskMint
            </Typography>
            {connected ? (
              <Typography variant="body2" sx={{ mb: 1 }}>
                {next
                  ? `Your next withdrawal: ${formatMaybeCents(next.totalCents, next.money.estimatedCents > 0)}, in the bank ${formatDay(next.arrivesOn)}.`
                  : 'Connected: nothing to withdraw yet.'}
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Not connected yet: turn on cloud sync in TaskMint with this account, and its withdrawals show up here.
              </Typography>
            )}
            <FormControlLabel
              control={<Switch checked={useTaskMint} onChange={event => setUseTaskMint(event.target.checked)} />}
              label="Count TaskMint’s withdrawals"
            />
            {useTaskMint && (
              <TextField
                select
                size="small"
                label="They reach the bank"
                value={delay}
                onChange={event => setDelay(Number(event.target.value))}
                sx={{ mt: 1, minWidth: 220 }}
              >
                <MenuItem value={0}>At once</MenuItem>
                <MenuItem value={24}>A day later</MenuItem>
                <MenuItem value={48}>Two days later</MenuItem>
                <MenuItem value={72}>Three days later</MenuItem>
              </TextField>
            )}
          </Box>
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => start(false)}>Start without a balance</Button>
            <Button variant="contained" onClick={() => start(true)}>
              Start
            </Button>
          </Stack>
          {parseDollars(amount) !== null && (
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
              Starting from {formatCents(parseDollars(amount)!)}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
            Signed in as {view.user?.email ?? 'you'}. Not the account you meant?{' '}
            <Link component="button" type="button" variant="caption" onClick={() => void session.signOut()}>
              Sign out
            </Link>
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
