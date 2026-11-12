/**
 * TaskMint: who's signed in to it (signing in to BudgetMint signs in to
 * TaskMint too when the accounts match; here when they don't), whether its
 * forecast is here and how fresh it is, and how the forecast counts its
 * withdrawals: when you withdraw, how long the money takes, what's counted,
 * and any earnings assumed ahead. Until TaskMint has been connected, only a
 * way to connect it (hooks/useTaskMint).
 */

import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { Savings as TaskMintIcon } from '@mui/icons-material';
import type { FutureEarnings, WithdrawPolicy } from '@budgetmint/contracts';
import { useBudget } from '../../../data/BudgetContext';
import { useSettings } from '../../../hooks/useSettingsChange';
import { useTaskMint } from '../../../hooks/useTaskMint';
import { getShell } from '../../../shell';
import { formatMoment } from '../../../utils/dates';
import { formattingLocale } from '../../../utils/locale';
import { importIsStale } from '../../../utils/taskmint';
import { SignInForm } from '../../auth/SignInForm';
import { AmountSetting } from './AmountSetting';
import { SettingsSection } from './SettingsSection';

/** How long a withdrawal may take to reach the bank (Settings and onboarding offer the same). */
export const DELAYS = [0, 12, 24, 48, 72, 120];

export const delayLabel = (hours: number) =>
  hours === 0 ? 'At once' : hours < 48 ? `${hours} hours later` : `${hours / 24} days later`;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

const weekdayName = (weekday: number) =>
  new Intl.DateTimeFormat(formattingLocale(), { weekday: 'long' }).format(new Date(2026, 10, 2 + weekday));
const hourName = (hour: number) =>
  new Intl.DateTimeFormat(formattingLocale(), { hour: 'numeric' }).format(new Date(2026, 10, 2, hour));

/** What Settings says to sign in to TaskMint alone: TaskMint's accounts are TaskMint's to make. */
const SIGN_IN_INTRO =
  'Not signed in to TaskMint. Sign in with your TaskMint account to see its withdrawals here: BudgetMint only reads its forecast.';

/** TaskMint's sign-in form, for TaskMint alone. */
function TaskMintSignIn({ intro }: { intro: string }) {
  const { session } = useBudget();
  return (
    <SignInForm
      engine={{
        signIn: session.signInToTaskMint,
        signInWithGoogle: session.signInToTaskMintWithGoogle,
        canUseGoogle: session.canUseGoogle,
      }}
      intro={intro}
      onPhone={getShell().capabilities.runtime === 'mobile'}
    />
  );
}

/** Before TaskMint is connected: what it's for, and a way to connect it. */
function ConnectTaskMint() {
  const [connecting, setConnecting] = useState(false);
  return (
    <SettingsSection title="TaskMint" icon={<TaskMintIcon />}>
      {connecting ? (
        <TaskMintSignIn intro="Sign in with your TaskMint account. BudgetMint only reads its forecast of what you’ll withdraw." />
      ) : (
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="body2" color="text.secondary">
            Use TaskMint? Connect it, and its withdrawals count as income in your forecast.
          </Typography>
          <Button variant="outlined" onClick={() => setConnecting(true)}>
            Connect TaskMint
          </Button>
        </Stack>
      )}
    </SettingsSection>
  );
}

export function TaskMintSection({ nowMs = Date.now() }: { nowMs?: number }) {
  const { shown } = useTaskMint();
  return shown ? <TaskMintSettings nowMs={nowMs} /> : <ConnectTaskMint />;
}

function TaskMintSettings({ nowMs }: { nowMs: number }) {
  const { session, view } = useBudget();
  const { forget } = useTaskMint();
  const [settings, save] = useSettings();
  const plan = settings.taskmint;
  const status = view.taskmint;
  const user = view.taskmintUser;
  const signedOut = !user && status.state === 'missing';
  const setPlan = (patch: Partial<typeof plan>) =>
    save(current => ({ ...current, taskmint: { ...current.taskmint, ...patch } }));
  const stale = importIsStale(status, nowMs);
  const policy: 'open' | 'weekly' = plan.policy.kind === 'weekly' ? 'weekly' : 'open';
  const weekly = plan.policy.kind === 'weekly' ? plan.policy : { kind: 'weekly' as const, weekday: 4, hour: 9 };
  const future = plan.future;

  return (
    <SettingsSection
      title="TaskMint"
      icon={<TaskMintIcon />}
      headerChildren={
        <Chip
          size="small"
          sx={{ ml: 1 }}
          color={status.state === 'ready' ? 'success' : 'default'}
          label={
            signedOut
              ? 'Not signed in'
              : {
                  checking: 'Checking…',
                  ready: 'Connected',
                  missing: 'Not connected',
                  newer: 'Update BudgetMint',
                  unreadable: 'Can’t read it',
                }[status.state]
          }
        />
      }
    >
      {user && (
        <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Typography variant="body2">
            Signed in to TaskMint as <strong>{user.email ?? 'you'}</strong>
            {user.providers.includes('google.com') ? ' with Google' : ''}.
          </Typography>
          <Button size="small" onClick={() => void session.signOutOfTaskMint().then(forget)}>
            Sign out of TaskMint
          </Button>
        </Stack>
      )}
      {signedOut && (
        <Box sx={{ mb: 3 }}>
          <TaskMintSignIn intro={SIGN_IN_INTRO} />
        </Box>
      )}
      {user && status.state === 'missing' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No TaskMint forecast yet. In TaskMint, turn on cloud sync (TaskMint 4.2 or later), and its withdrawals show up
          here.
        </Alert>
      )}
      {status.state === 'newer' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          TaskMint {status.appVersion} publishes a forecast this BudgetMint can’t read. Update BudgetMint.
        </Alert>
      )}
      {status.state === 'unreadable' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          TaskMint’s forecast can’t be read. It’ll be published again when its data next changes.
        </Alert>
      )}
      {status.state === 'ready' && (
        <Typography variant="body2" color={stale ? 'warning.main' : 'text.secondary'} sx={{ mb: 2 }}>
          {status.lastImportMs !== null
            ? `Work logs last imported ${formatMoment(status.lastImportMs)}${stale ? ': the numbers may be out of date until you import again' : ''}.`
            : 'No work logs imported yet: only tracked time.'}{' '}
          {status.appVersion && `Published by TaskMint ${status.appVersion}.`}
        </Typography>
      )}

      <Stack spacing={2} sx={{ maxWidth: 520 }}>
        <FormControlLabel
          control={
            <Switch checked={plan.useForecast} onChange={event => setPlan({ useForecast: event.target.checked })} />
          }
          label="Count TaskMint’s withdrawals in the forecast"
        />
        {plan.useForecast && (
          <>
            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2 }}>
              <TextField
                select
                label="You withdraw"
                value={policy}
                onChange={event =>
                  setPlan({
                    policy: (event.target.value === 'open' ? { kind: 'asSoonAsOpen' } : weekly) as WithdrawPolicy,
                  })
                }
                sx={{ minWidth: 220 }}
              >
                <MenuItem value="open">As soon as the site allows</MenuItem>
                <MenuItem value="weekly">Once a week</MenuItem>
              </TextField>
              {policy === 'weekly' && (
                <>
                  <TextField
                    select
                    label="On"
                    value={weekly.weekday}
                    onChange={event => setPlan({ policy: { ...weekly, weekday: Number(event.target.value) } })}
                  >
                    {WEEKDAYS.map(day => (
                      <MenuItem key={day} value={day}>
                        {weekdayName(day)}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    label="At"
                    value={weekly.hour}
                    onChange={event => setPlan({ policy: { ...weekly, hour: Number(event.target.value) } })}
                  >
                    {HOURS.map(hour => (
                      <MenuItem key={hour} value={hour}>
                        {hourName(hour)}
                      </MenuItem>
                    ))}
                  </TextField>
                </>
              )}
            </Stack>
            <TextField
              select
              label="It reaches the bank"
              value={plan.arrivalDelayHours}
              onChange={event => setPlan({ arrivalDelayHours: Number(event.target.value) })}
              sx={{ maxWidth: 220 }}
            >
              {DELAYS.map(hours => (
                <MenuItem key={hours} value={hours}>
                  {delayLabel(hours)}
                </MenuItem>
              ))}
            </TextField>
            <AmountSetting
              label="Wait until there’s at least"
              cents={plan.minWithdrawalCents}
              onSave={cents => setPlan({ minWithdrawalCents: cents })}
              sx={{ maxWidth: 220 }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={plan.countEstimates}
                  onChange={event => setPlan({ countEstimates: event.target.checked })}
                />
              }
              label="Count time tracked but not imported yet (TaskMint’s ~ amounts)"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={plan.countPastDue}
                  onChange={event => setPlan({ countPastDue: event.target.checked })}
                />
              }
              label="Count money still pending past its release"
            />
            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2 }}>
              <TextField
                select
                label="Earnings ahead"
                value={future.kind}
                onChange={event => {
                  const kind = event.target.value as FutureEarnings['kind'];
                  setPlan({
                    future: kind === 'off' ? { kind } : kind === 'weekly' ? { kind, cents: 0 } : { kind, weeks: 4 },
                  });
                }}
                helperText="TaskMint knows only work already done. Beyond that, the forecast can assume more."
                sx={{ minWidth: 260 }}
              >
                <MenuItem value="off">Only what TaskMint knows</MenuItem>
                <MenuItem value="weekly">A set amount a week</MenuItem>
                <MenuItem value="trailing">What recent weeks averaged</MenuItem>
              </TextField>
              {future.kind === 'weekly' && (
                <AmountSetting
                  label="A week"
                  cents={future.cents}
                  onSave={cents => setPlan({ future: { kind: 'weekly', cents } })}
                  sx={{ maxWidth: 180 }}
                />
              )}
              {future.kind === 'trailing' && (
                <TextField
                  select
                  label="Over the last"
                  value={future.weeks}
                  onChange={event => setPlan({ future: { kind: 'trailing', weeks: Number(event.target.value) } })}
                >
                  {[1, 2, 4, 8, 12].map(weeks => (
                    <MenuItem key={weeks} value={weeks}>
                      {weeks === 1 ? '1 week' : `${weeks} weeks`}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </Stack>
          </>
        )}
      </Stack>
    </SettingsSection>
  );
}
