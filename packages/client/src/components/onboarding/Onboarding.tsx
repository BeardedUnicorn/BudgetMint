/**
 * The first time, a few steps so the Overview's numbers mean something from
 * the start: the bank balance (and, with TaskMint signed in alongside, how
 * its withdrawals count), the pay that comes in, what everyday spending
 * takes a week, and the bills most people have. Each but the first can be
 * skipped. Pay and bills are saved as their step ends; the balance and the
 * settings at the last, since saving the settings is what ends onboarding
 * (it comes once per account).
 */

import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  InputAdornment,
  Link,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import type { ItemInput } from '@budgetmint/contracts';
import { useBudget, useBudgetChange, useCoreQuery } from '../../data/BudgetContext';
import { useTaskMint } from '../../hooks/useTaskMint';
import { formatDay, formatWeekday } from '../../utils/dates';
import { ordinal } from '../../utils/describe';
import { currencySymbol, formatCents, formatMaybeCents, parseDollars } from '../../utils/money';
import { partsOf, repeatOf } from '../budget/ItemDialog';
import { type Every, RepeatField } from '../budget/RepeatField';
import { CurrencyInput } from '../ui/forms/CurrencyInput';
import { Wordmark } from '../ui/display/Wordmark';
import { DELAYS, delayLabel } from '../pages/settings/TaskMintSection';

type Step = 'balance' | 'pay' | 'spending' | 'bills';
const STEPS: Step[] = ['balance', 'pay', 'spending', 'bills'];

const TITLES: Record<Step, string> = {
  balance: 'Your bank balance',
  pay: 'Your pay',
  spending: 'Everyday spending',
  bills: 'Your regular bills',
};

/** The bills most people have, each monthly, filed under a category. */
const COMMON_BILLS = [
  { name: 'Rent or mortgage', category: 'Housing', varies: false },
  { name: 'Phone', category: 'Utilities', varies: false },
  { name: 'Internet', category: 'Utilities', varies: false },
  { name: 'Electric', category: 'Utilities', varies: true },
  { name: 'Car payment', category: 'Car', varies: false },
  { name: 'Car insurance', category: 'Car', varies: false },
  { name: 'Subscriptions', category: 'Subscriptions', varies: false },
];

const dayLabel = (value: number) => (value === 31 ? 'The last day' : `The ${ordinal(value)}`);

interface BillRow {
  ticked: boolean;
  amount: string;
  day: number;
}

export function Onboarding() {
  const { session, view } = useBudget();
  const { settings } = useCoreQuery('get_settings');
  const overview = useCoreQuery('get_overview');
  const { today } = overview;
  const change = useBudgetChange();
  const { shown: taskmintShown } = useTaskMint();
  const [step, setStep] = useState<Step>('balance');
  const [problem, setProblem] = useState<string | null>(null);
  /** A field left wrong: said under it, and focus goes to it. */
  const [wrong, setWrong] = useState<{ field: string; message: string } | null>(null);
  const focused = useRef<HTMLInputElement | null>(null);

  // The balance, and TaskMint's withdrawals
  const [amount, setAmount] = useState('');
  const [asOf, setAsOf] = useState(today);
  const [counted, setCounted] = useState(true);
  const [delay, setDelay] = useState(settings.taskmint.arrivalDelayHours);
  // Pay
  const [payName, setPayName] = useState('Paycheck');
  const [pay, setPay] = useState('');
  const [payEvery, setPayEvery] = useState<Every>('weeks');
  const [payN, setPayN] = useState('2');
  const [payCustom, setPayCustom] = useState(false);
  const [payday, setPayday] = useState(today);
  // Everyday spending, a week
  const [spending, setSpending] = useState('');
  // The common bills
  const [bills, setBills] = useState<BillRow[]>(() =>
    COMMON_BILLS.map(() => ({ ticked: false, amount: '', day: Number(today.slice(8, 10)) }))
  );

  const connected = view.taskmint.state === 'ready';
  const next = overview.nextWithdrawal;
  const index = STEPS.indexOf(step);
  const last = index === STEPS.length - 1;
  const balanceCents = parseDollars(amount);

  const refuse = (field: string, message: string) => {
    setProblem(null);
    setWrong({ field, message });
    // The field just marked is the one to fix
    queueMicrotask(() => focused.current?.focus());
  };
  const wrongAt = (field: string) => (wrong?.field === field ? wrong.message : undefined);
  /** Whether `field` is wrong, and the ref that takes the focus when it is. */
  const marked = (field: string) => ({
    error: wrong?.field === field,
    inputRef: wrong?.field === field ? focused : undefined,
  });

  const go = (to: number) => {
    setProblem(null);
    setWrong(null);
    setStep(STEPS[to]);
  };

  const save = (item: ItemInput) => change('save_item', { item, edit: false });

  /** The bills ticked, saved (once onboarding has ended, so a refusal can't save them twice). */
  const saveBills = () => {
    bills.forEach((row, at) => {
      if (!row.ticked) return;
      const bill = COMMON_BILLS[at];
      save({
        id: crypto.randomUUID(),
        kind: 'bill',
        name: bill.name,
        category: bill.category,
        schedule: [
          {
            from: today,
            until: null,
            repeat: { every: 'months', n: 1, day: row.day },
            amountCents: parseDollars(row.amount)!,
            weekends: 'keep',
          },
        ],
        autopay: false,
        reminder: { leadDays: [settings.reminders.leadDays] },
        archived: false,
        note: null,
        varies: bill.varies,
        saveUp: false,
      });
    });
  };

  /** Ends onboarding: the balance (when there is one), then the settings. Whether it did. */
  const finish = () => {
    try {
      // The balance first: a refused one stops it all (saving the settings keeps it)
      if (balanceCents !== null) change('set_balance', { balance: { cents: balanceCents, asOf } });
      change('save_settings', {
        settings: {
          ...settings,
          spendingWeeklyCents: parseDollars(spending) ?? settings.spendingWeeklyCents,
          taskmint: { ...settings.taskmint, useForecast: counted, arrivalDelayHours: delay },
        },
      });
    } catch (error) {
      setProblem((error as Error).message);
      return false;
    }
    return true;
  };

  /** This step's Next: what it asks for checked (and pay and bills saved), then the next step, or the end. */
  const done = () => {
    setProblem(null);
    setWrong(null);
    try {
      if (step === 'balance') {
        if (balanceCents === null) return refuse('balance', 'Enter your balance, or skip it');
        // Core's own rule, said here rather than at the end
        if (asOf > today) return refuse('asOf', 'Set the balance as of today or a day before');
      }
      if (step === 'pay') {
        const cents = parseDollars(pay);
        if (cents === null) return refuse('pay', 'Enter what each pays, or skip it');
        const parts = partsOf(undefined, payday);
        save({
          id: crypto.randomUUID(),
          kind: 'income',
          name: payName,
          category: 'Pay',
          schedule: [
            {
              from: payday,
              until: null,
              repeat: repeatOf(payEvery, { ...parts, n: Number(payN) }),
              amountCents: cents,
              weekends: 'keep',
            },
          ],
          autopay: true,
          reminder: null,
          archived: false,
          note: null,
          varies: false,
          saveUp: false,
        });
        // Saved: going back here doesn't add it twice
        setPay('');
      }
      if (step === 'spending' && parseDollars(spending) === null) {
        return refuse('spending', 'Enter a week’s worth, or skip it');
      }
      if (step === 'bills') {
        const missing = bills.findIndex(row => row.ticked && parseDollars(row.amount) === null);
        if (missing >= 0) return refuse(`bill-${missing}`, 'Enter the amount');
      }
    } catch (error) {
      // Pay's name, left empty: the only thing here core could refuse
      setProblem((error as Error).message);
      return;
    }
    if (!last) go(index + 1);
    else if (finish()) saveBills();
  };

  /** Skips this step: no balance, or no everyday spending, or neither pay nor bills. */
  const skip = () => {
    if (step === 'balance') setAmount('');
    if (step === 'spending') setSpending('');
    if (last) finish();
    else go(index + 1);
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
            {taskmintShown
              ? 'A few things, and you’re set: what your bank account holds, how TaskMint’s money comes in, your pay and your bills.'
              : 'A few things, and you’re set: what your bank account holds, your pay, and your bills.'}
          </Typography>
        </Stack>
        {problem && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {problem}
          </Alert>
        )}
        {/* Enter goes on, as Next does */}
        <Stack
          spacing={3}
          component="form"
          noValidate
          onSubmit={event => {
            event.preventDefault();
            done();
          }}
        >
          <Box component="section" aria-labelledby="step-title">
            <Typography variant="caption" color="text.secondary">
              Step {index + 1} of {STEPS.length}
            </Typography>
            <Typography id="step-title" variant="h6" component="h2" sx={{ mb: 1 }}>
              {TITLES[step]}
            </Typography>

            {step === 'balance' && (
              <Stack spacing={3}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Balance"
                    value={amount}
                    onChange={event => setAmount(event.target.value)}
                    {...marked('balance')}
                    helperText={wrongAt('balance')}
                    autoFocus
                    sx={{ flex: 1 }}
                    slotProps={{
                      input: {
                        startAdornment: <InputAdornment position="start">{currencySymbol()}</InputAdornment>,
                      },
                      htmlInput: { inputMode: 'decimal' },
                    }}
                  />
                  <TextField
                    label="As of"
                    type="date"
                    value={asOf}
                    onChange={event => setAsOf(event.target.value)}
                    {...marked('asOf')}
                    helperText={wrongAt('asOf') ?? 'Today, or the day your bank last said'}
                    sx={{ flex: 1 }}
                    slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
                  />
                </Stack>
                {balanceCents !== null && (
                  <Typography variant="caption" color="text.secondary">
                    Starting from {formatCents(balanceCents)}
                  </Typography>
                )}
                {taskmintShown && (
                  <Box component="section" aria-labelledby="taskmint-title">
                    <Typography id="taskmint-title" variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
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
                        {view.taskmint.state === 'checking'
                          ? 'Checking TaskMint…'
                          : view.taskmintUser
                            ? 'Not connected yet: turn on cloud sync in TaskMint, and its withdrawals show up here.'
                            : 'Not signed in to TaskMint: your TaskMint account isn’t this one. Sign in to it later in Settings → TaskMint.'}
                      </Typography>
                    )}
                    <FormControlLabel
                      control={<Switch checked={counted} onChange={event => setCounted(event.target.checked)} />}
                      label="Count TaskMint’s withdrawals"
                    />
                    {counted && (
                      <TextField
                        select
                        size="small"
                        label="They reach the bank"
                        value={delay}
                        onChange={event => setDelay(Number(event.target.value))}
                        sx={{ mt: 1, minWidth: 220 }}
                      >
                        {DELAYS.map(hours => (
                          <MenuItem key={hours} value={hours}>
                            {delayLabel(hours)}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                  </Box>
                )}
              </Stack>
            )}

            {step === 'pay' && (
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  What comes in from work. More income, and the rest, can be added later.
                </Typography>
                <TextField
                  label="Name"
                  value={payName}
                  onChange={event => setPayName(event.target.value)}
                  {...marked('payName')}
                  helperText={wrongAt('payName')}
                />
                <CurrencyInput
                  label="Each pays"
                  value={pay}
                  onChange={setPay}
                  error={wrong?.field === 'pay'}
                  helperText={wrongAt('pay')}
                  inputRef={wrong?.field === 'pay' ? focused : undefined}
                  autoFocus
                />
                <RepeatField
                  every={payEvery}
                  n={payN}
                  custom={payCustom}
                  onChange={(every, n) => {
                    setPayEvery(every);
                    setPayN(n);
                  }}
                  onCustom={() => setPayCustom(true)}
                />
                <TextField
                  label="Next payday"
                  type="date"
                  value={payday}
                  onChange={event => setPayday(event.target.value)}
                  helperText={payday ? `Starting ${formatWeekday(payday)}` : undefined}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Stack>
            )}

            {step === 'spending' && (
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  Groceries, fuel, eating out: what goes besides the bills. A rough week’s worth is fine. Without it,
                  BudgetMint counts all the money the bills leave as safe to spend.
                </Typography>
                <CurrencyInput
                  label="A week"
                  value={spending}
                  onChange={setSpending}
                  error={wrong?.field === 'spending'}
                  helperText={wrongAt('spending')}
                  inputRef={wrong?.field === 'spending' ? focused : undefined}
                  autoFocus
                />
              </Stack>
            )}

            {step === 'bills' && (
              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  Tick the ones you have, with what each is and the day it’s due. Each repeats monthly; others can be
                  added on the Bills page.
                </Typography>
                {COMMON_BILLS.map((bill, at) => {
                  const row = bills[at];
                  const set = (patch: Partial<BillRow>) =>
                    setBills(rows => rows.map((one, which) => (which === at ? { ...one, ...patch } : one)));
                  return (
                    <Stack key={bill.name} spacing={1}>
                      <FormControlLabel
                        control={
                          <Checkbox checked={row.ticked} onChange={event => set({ ticked: event.target.checked })} />
                        }
                        label={bill.name}
                      />
                      {row.ticked && (
                        <Stack direction="row" spacing={2} sx={{ pl: 4 }}>
                          <CurrencyInput
                            label={`${bill.name}: amount`}
                            value={row.amount}
                            onChange={value => set({ amount: value })}
                            error={wrong?.field === `bill-${at}`}
                            helperText={
                              wrongAt(`bill-${at}`) ?? (bill.varies ? 'About: it learns from what you pay' : undefined)
                            }
                            inputRef={wrong?.field === `bill-${at}` ? focused : undefined}
                            sx={{ flex: 1 }}
                          />
                          <TextField
                            select
                            label="Due on"
                            value={row.day}
                            onChange={event => set({ day: Number(event.target.value) })}
                            sx={{ flex: 1 }}
                          >
                            {Array.from({ length: 31 }, (_, day) => day + 1).map(day => (
                              <MenuItem key={day} value={day}>
                                {dayLabel(day)}
                              </MenuItem>
                            ))}
                          </TextField>
                        </Stack>
                      )}
                    </Stack>
                  );
                })}
              </Stack>
            )}
          </Box>

          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            {index > 0 && (
              <Button type="button" onClick={() => go(index - 1)} sx={{ mr: 'auto' }}>
                Back
              </Button>
            )}
            <Button type="button" onClick={skip}>
              Skip
            </Button>
            <Button type="submit" variant="contained">
              {last ? 'Start' : 'Next'}
            </Button>
          </Stack>
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
