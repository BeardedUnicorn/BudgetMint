/**
 * Setting the balance the forecast starts from: what the bank account
 * holds, as of a day (today, or the last day the bank shows). It's checked
 * against what BudgetMint expected by then (core's get_balance_check): the
 * bills and income due since the last balance are listed, none ticked; the
 * ones ticked came out (or in), at what each really came to, and the rest
 * are still to come, the day after. Saving settles them and keeps the check
 * (core's settle), with one Undo.
 */

import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { Balance, OccRef, OccurrenceView, PaidInput } from '@budgetmint/contracts';
import { useBudget, useBudgetChange, useCoreQuery } from '../../data/BudgetContext';
import { useDirty } from '../../hooks/useDirty';
import { formatDay } from '../../utils/dates';
import { centsToInput, currencySymbol, formatCents, formatMaybeCents, parseDollars } from '../../utils/money';
import { FormDialog } from '../ui/dialogs/FormDialog';
import { CurrencyInput } from '../ui/forms/CurrencyInput';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What each ticked one came to, as typed, by `keyOf`: ticked is being in it. */
type Ticked = Record<string, string>;

const keyOf = (view: OccurrenceView) => `${view.itemId} ${view.scheduled}`;
const refOf = (view: OccurrenceView): OccRef => ({ itemId: view.itemId, date: view.scheduled });

/** What the new balance is against what was expected, in words. */
function differenceLine(difference: number): string {
  if (difference === 0) return 'That’s just what you have.';
  if (difference > 0) return `You have ${formatCents(difference)} more than that.`;
  return `You have ${formatCents(-difference)} less: spending besides your bills, or something not in BudgetMint.`;
}

/** The ticked ones, paid on their day at what they came to (those whose amount reads). */
function paidOf(open: OccurrenceView[], ticked: Ticked): PaidInput[] {
  return open.flatMap(view => {
    const cents = keyOf(view) in ticked ? parseDollars(ticked[keyOf(view)]) : null;
    return cents === null ? [] : [{ itemId: view.itemId, date: view.scheduled, on: view.due, amountCents: cents }];
  });
}

function BalanceCheck({
  balance,
  ticked,
  missing,
  onTicked,
}: {
  balance: Balance;
  ticked: Ticked;
  /** A ticked one without an amount, said under it. */
  missing: string | null;
  onTicked: (ticked: Ticked) => void;
}) {
  const { open } = useCoreQuery('get_balance_check', { balance });
  const check = useCoreQuery('get_balance_check', {
    balance,
    stillOpen: open.filter(view => !(keyOf(view) in ticked)).map(refOf),
    amounts: paidOf(open, ticked),
  });
  // Ticked, it starts at what was expected; one whose amount varies, empty to say
  const tick = (view: OccurrenceView) => [keyOf(view), view.varies ? '' : centsToInput(view.expectedCents)];
  return (
    <>
      {check.expectedCents !== null && check.differenceCents !== null && (
        <Alert severity={check.differenceCents < 0 ? 'warning' : 'info'}>
          BudgetMint expected {formatCents(check.expectedCents)} by the end of {formatDay(balance.asOf)}.{' '}
          {differenceLine(check.differenceCents)}
        </Alert>
      )}
      {open.length > 0 && (
        <FormGroup aria-label="Bills and income since your last balance">
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Which of these came out (or in) by then?
            </Typography>
            <Button size="small" onClick={() => onTicked({ ...Object.fromEntries(open.map(tick)), ...ticked })}>
              Tick all
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            The ones left are still to come: they move to the day after.
          </Typography>
          {open.map(view => {
            const key = keyOf(view);
            return (
              <Stack key={key}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={key in ticked}
                      onChange={event => {
                        const { [key]: _, ...others } = ticked;
                        onTicked(event.target.checked ? { ...ticked, ...Object.fromEntries([tick(view)]) } : others);
                      }}
                    />
                  }
                  label={`${view.name}: ${view.kind === 'income' ? '+' : ''}${formatMaybeCents(view.expectedCents, view.estimated)}, due ${formatDay(view.due)}`}
                />
                {key in ticked && (
                  <CurrencyInput
                    label={`What ${view.name} came to`}
                    value={ticked[key]}
                    onChange={amount => onTicked({ ...ticked, [key]: amount })}
                    error={missing === key}
                    helperText={missing === key ? 'Enter what it came to' : undefined}
                    sx={{ pl: 4, mb: 1 }}
                  />
                )}
              </Stack>
            );
          })}
        </FormGroup>
      )}
    </>
  );
}

export function BalanceDialog({
  balance,
  today,
  onClose,
}: {
  balance: Balance | null;
  today: string;
  onClose: () => void;
}) {
  const { core } = useBudget();
  const change = useBudgetChange();
  const [amount, setAmount] = useState('');
  const [asOf, setAsOf] = useState(today);
  const [ticked, setTicked] = useState<Ticked>({});
  const [missing, setMissing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** The balance isn't an amount: said under it, and focus goes to it. */
  const [wrong, setWrong] = useState(false);
  const balanceInput = useRef<HTMLInputElement>(null);
  const dirty = useDirty([amount, asOf, ticked]);
  const cents = parseDollars(amount);
  const typed = cents !== null && DAY.test(asOf) ? { cents, asOf } : null;

  const submit = () => {
    setWrong(cents === null);
    if (cents === null) {
      setProblem(null);
      balanceInput.current?.focus();
      return;
    }
    const given = { cents, asOf };
    try {
      const { open } = core.call('get_balance_check', { balance: given });
      // Each ticked one needs what it came to
      const unsaid = open.find(view => keyOf(view) in ticked && parseDollars(ticked[keyOf(view)]) === null);
      setMissing(unsaid ? keyOf(unsaid) : null);
      if (unsaid) return;
      const stillOpen = open.filter(view => !(keyOf(view) in ticked)).map(refOf);
      change('settle', { paid: paidOf(open, ticked), stillOpen, balance: given }, 'Balance updated');
    } catch (error) {
      setProblem((error as Error).message);
      return;
    }
    onClose();
  };

  return (
    <FormDialog onClose={onClose} dirty={dirty} title="Your balance" onSubmit={submit}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          What your bank account holds, as of a day: today, or the last day your bank shows. Bills and income after it
          move it from there.
        </Typography>
        {problem && <Alert severity="error">{problem}</Alert>}
        <TextField
          label="Balance"
          value={amount}
          onChange={event => setAmount(event.target.value)}
          autoFocus
          inputRef={balanceInput}
          error={wrong}
          helperText={
            wrong
              ? 'Enter what the bank account holds (a minus sign if it’s overdrawn)'
              : balance && `Last: ${formatCents(balance.cents)}, at the end of ${formatDay(balance.asOf)}`
          }
          slotProps={{
            input: { startAdornment: <InputAdornment position="start">{currencySymbol()}</InputAdornment> },
            htmlInput: { inputMode: 'decimal' },
          }}
        />
        <TextField
          label="As of"
          type="date"
          value={asOf}
          onChange={event => setAsOf(event.target.value)}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
        />
        {typed && <BalanceCheck balance={typed} ticked={ticked} missing={missing} onTicked={setTicked} />}
      </Stack>
    </FormDialog>
  );
}
