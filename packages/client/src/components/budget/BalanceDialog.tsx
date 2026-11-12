/**
 * Setting the balance the forecast starts from: what the account holds,
 * as of the end of a day (today, or one before, if today's spending isn't
 * in it yet). It's checked against what BudgetMint expected by then (core's
 * get_balance_check): the open bills and income due since the last balance
 * are taken as in it, unless the user says one hasn't come out (or in) yet,
 * which leaves it to come the day after. Saving settles them and keeps the
 * check (core's settle), with one Undo.
 */

import { useRef, useState } from 'react';
import {
  Alert,
  Checkbox,
  FormControlLabel,
  FormGroup,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { Balance, OccRef, OccurrenceView } from '@budgetmint/contracts';
import { useBudget, useBudgetChange, useCoreQuery } from '../../data/BudgetContext';
import { useDirty } from '../../hooks/useDirty';
import { formatDay } from '../../utils/dates';
import { centsToInput, currencySymbol, formatCents, formatMaybeCents, parseDollars } from '../../utils/money';
import { FormDialog } from '../ui/dialogs/FormDialog';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const same = (open: OccRef, view: OccurrenceView) => open.itemId === view.itemId && open.date === view.scheduled;

/** What the new balance is against what was expected, in words. */
function differenceLine(difference: number): string {
  if (difference === 0) return 'That’s just what you have.';
  if (difference > 0) return `You have ${formatCents(difference)} more than that.`;
  return `You have ${formatCents(-difference)} less: spending besides your bills, or something not in BudgetMint.`;
}

function BalanceCheck({
  balance,
  stillOpen,
  onToggle,
}: {
  balance: Balance;
  stillOpen: OccRef[];
  onToggle: (view: OccurrenceView, cameOut: boolean) => void;
}) {
  const check = useCoreQuery('get_balance_check', { balance, stillOpen });
  return (
    <>
      {check.expectedCents !== null && check.differenceCents !== null && (
        <Alert severity={check.differenceCents < 0 ? 'warning' : 'info'}>
          BudgetMint expected {formatCents(check.expectedCents)} by the end of {formatDay(balance.asOf)}.{' '}
          {differenceLine(check.differenceCents)}
        </Alert>
      )}
      {check.open.length > 0 && (
        <FormGroup aria-label="Bills and income since your last balance">
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Did these come out (or in) by then?
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Unticked ones are still to come: they move to the day after.
          </Typography>
          {check.open.map(view => (
            <FormControlLabel
              key={`${view.itemId} ${view.scheduled}`}
              control={
                <Checkbox
                  checked={!stillOpen.some(open => same(open, view))}
                  onChange={event => onToggle(view, event.target.checked)}
                />
              }
              label={`${view.name}: ${view.kind === 'income' ? '+' : ''}${formatMaybeCents(view.expectedCents, view.estimated)}, due ${formatDay(view.due)}`}
            />
          ))}
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
  const [amount, setAmount] = useState(centsToInput(balance?.cents ?? null));
  const [asOf, setAsOf] = useState(today);
  const [stillOpen, setStillOpen] = useState<OccRef[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  /** The balance isn't an amount: said under it, and focus goes to it. */
  const [wrong, setWrong] = useState(false);
  const balanceInput = useRef<HTMLInputElement>(null);
  const dirty = useDirty([amount, asOf, stillOpen]);
  const cents = parseDollars(amount);
  const typed = cents !== null && DAY.test(asOf) ? { cents, asOf } : null;

  const toggle = (view: OccurrenceView, cameOut: boolean) =>
    setStillOpen(current =>
      cameOut ? current.filter(open => !same(open, view)) : [...current, { itemId: view.itemId, date: view.scheduled }]
    );

  const submit = () => {
    setWrong(cents === null);
    if (cents === null) {
      setProblem(null);
      balanceInput.current?.focus();
      return;
    }
    const given = { cents, asOf };
    try {
      // The ones not still to come are in the balance: paid on their day, at what was expected
      const { open } = core.call('get_balance_check', { balance: given, stillOpen });
      const paid = open
        .filter(view => !stillOpen.some(at => same(at, view)))
        .map(view => ({ itemId: view.itemId, date: view.scheduled, on: view.due, amountCents: view.expectedCents }));
      const left = stillOpen.filter(at => open.some(view => same(at, view)));
      change('settle', { paid, stillOpen: left, balance: given }, 'Balance updated');
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
          What your account holds now. Bills and income after that day move it from there.
        </Typography>
        {problem && <Alert severity="error">{problem}</Alert>}
        <TextField
          label="Balance"
          value={amount}
          onChange={event => setAmount(event.target.value)}
          autoFocus
          inputRef={balanceInput}
          error={wrong}
          helperText={wrong ? 'Enter what the account holds (a minus sign if it’s overdrawn)' : undefined}
          slotProps={{
            input: { startAdornment: <InputAdornment position="start">{currencySymbol()}</InputAdornment> },
            htmlInput: { inputMode: 'decimal' },
          }}
        />
        <TextField
          label="As of the end of"
          type="date"
          value={asOf}
          onChange={event => setAsOf(event.target.value)}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
        />
        {typed && <BalanceCheck balance={typed} stillOpen={stillOpen} onToggle={toggle} />}
      </Stack>
    </FormDialog>
  );
}
