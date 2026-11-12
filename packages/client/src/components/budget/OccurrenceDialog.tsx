/**
 * One occurrence of a bill or income: paid (when, how much), skipped, or
 * still to come; this time's amount, its due date, and a note. Newly paid
 * by the balance's day, it can move the balance too (FromBalance).
 */

import { useRef, useState } from 'react';
import { Alert, Checkbox, FormControlLabel, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import type { OccStatus, OccurrenceView } from '@budgetmint/contracts';
import { LIMITS } from '@budgetmint/contracts';
import { useBudgetChange } from '../../data/BudgetContext';
import { useDirty } from '../../hooks/useDirty';
import { formatDay } from '../../utils/dates';
import { centsToInput, formatMaybeCents, parseDollars } from '../../utils/money';
import { FormDialog } from '../ui/dialogs/FormDialog';
import { CurrencyInput } from '../ui/forms/CurrencyInput';
import { FromBalanceField, savedSaying, useFromBalance } from './FromBalance';

type State = OccStatus['state'];

export function OccurrenceDialog({
  occurrence,
  today,
  askAmount = false,
  paying = false,
  onClose,
}: {
  occurrence: OccurrenceView;
  today: string;
  /**
   * Opened to say what it came to: marked paid (or received), with the
   * amount left empty to type (an amount that varies would be recorded at
   * its estimate otherwise).
   */
  askAmount?: boolean;
  /**
   * Opened to mark it paid (or received) at its amount: Mark paid on the
   * balance's own day, where whether it's in the balance is asked.
   */
  paying?: boolean;
  onClose: () => void;
}) {
  const change = useBudgetChange();
  const status = occurrence.status;
  const bill = occurrence.kind === 'bill';
  const [state, setState] = useState<State>(askAmount || paying ? 'done' : status.state);
  // Paid today, as Mark paid records it; one on autopay was paid on its day
  const [paidOn, setPaidOn] = useState(
    status.state === 'done' ? status.on : occurrence.autopay && occurrence.due < today ? occurrence.due : today
  );
  const [paid, setPaid] = useState(
    askAmount ? '' : centsToInput(status.state === 'done' ? status.amountCents : occurrence.expectedCents)
  );
  const [expected, setExpected] = useState(centsToInput(occurrence.expectedCents));
  /** Back to the schedule's amount: this time's own amount is dropped. */
  const [usual, setUsual] = useState(false);
  const [due, setDue] = useState(occurrence.due);
  const [note, setNote] = useState(occurrence.note ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  /** The amount left wrong: said under it, and focus goes to it. */
  const [wrong, setWrong] = useState<'paid' | 'expected' | null>(null);
  const paidInput = useRef<HTMLInputElement>(null);
  const expectedInput = useRef<HTMLInputElement>(null);
  // Paid just now (not before): it may move the balance
  const fromBalance = useFromBalance(state === 'done' && status.state !== 'done' ? paidOn : null);
  const dirty = useDirty([state, paidOn, paid, expected, usual, due, note, fromBalance.checked]);

  const submit = () => {
    const paidCents = parseDollars(paid);
    // Its field shows only while it's still to come: otherwise it stays as it was
    const expectedCents = state === 'open' ? parseDollars(expected) : occurrence.expectedCents;
    // Only the amount on show can be wrong: what was paid, or (still to come) what's expected this time
    const missing =
      state === 'done' && paidCents === null
        ? 'paid'
        : state === 'open' && !usual && expectedCents === null
          ? 'expected'
          : null;
    setWrong(missing);
    if (missing) {
      setProblem(null);
      (missing === 'paid' ? paidInput : expectedInput).current?.focus();
      return;
    }
    const next: OccStatus = state === 'done' ? { state, on: paidOn, amountCents: paidCents! } : { state };
    try {
      change(
        'set_occurrence',
        {
          occurrence: {
            itemId: occurrence.itemId,
            date: occurrence.scheduled,
            status: next,
            // Only an amount of its own is kept: left as it was, it still follows the schedule
            amountCents: usual
              ? null
              : expectedCents === occurrence.expectedCents
                ? occurrence.amountCents
                : expectedCents,
            movedTo: due === occurrence.scheduled ? null : due,
            note: note || null,
          },
          fromBalance: fromBalance.checked,
        },
        savedSaying(`${occurrence.name} saved`, occurrence.kind, fromBalance.checked)
      );
    } catch (error) {
      setProblem((error as Error).message);
      return;
    }
    onClose();
  };

  return (
    <FormDialog
      onClose={onClose}
      dirty={dirty}
      title={`${occurrence.name}, ${formatDay(occurrence.scheduled)}`}
      onSubmit={submit}
    >
      <Stack spacing={2}>
        {problem && <Alert severity="error">{problem}</Alert>}
        <Typography variant="body2" color="text.secondary">
          {formatMaybeCents(occurrence.expectedCents, occurrence.estimated)} due {formatDay(occurrence.due)}
          {occurrence.autopay ? (bill ? ', on autopay' : ', comes in automatically') : ''}
          {occurrence.estimated ? ' (its amount varies: this is the average of the last few)' : ''}
        </Typography>
        <RadioGroup value={state} onChange={event => setState(event.target.value as State)} aria-label="What happened">
          <FormControlLabel value="open" control={<Radio />} label={bill ? 'Still to pay' : 'Still to come'} />
          <FormControlLabel value="done" control={<Radio />} label={bill ? 'Paid' : 'Received'} />
          <FormControlLabel value="skipped" control={<Radio />} label="Not this time (skip it)" />
        </RadioGroup>
        {state === 'done' && (
          <Stack direction="row" spacing={2}>
            <TextField
              label={bill ? 'Paid on' : 'Received on'}
              type="date"
              value={paidOn}
              onChange={event => setPaidOn(event.target.value)}
              sx={{ flex: 1 }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <CurrencyInput
              label="Amount"
              value={paid}
              onChange={setPaid}
              error={wrong === 'paid'}
              helperText={wrong === 'paid' ? 'Enter the amount' : undefined}
              inputRef={paidInput}
              autoFocus={askAmount}
              sx={{ flex: 1 }}
            />
          </Stack>
        )}
        <FromBalanceField kind={occurrence.kind} amountCents={parseDollars(paid)} on={paidOn} state={fromBalance} />
        {state === 'open' && (
          <Stack direction="row" spacing={2}>
            <TextField
              label="Due"
              type="date"
              value={due}
              onChange={event => setDue(event.target.value)}
              sx={{ flex: 1 }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <CurrencyInput
              label="This time"
              value={usual ? '' : expected}
              onChange={setExpected}
              disabled={usual}
              error={wrong === 'expected'}
              helperText={wrong === 'expected' ? 'Enter the amount' : undefined}
              inputRef={expectedInput}
              sx={{ flex: 1 }}
            />
          </Stack>
        )}
        {state === 'open' && occurrence.amountCents !== null && (
          <FormControlLabel
            control={<Checkbox checked={usual} onChange={event => setUsual(event.target.checked)} />}
            label="Back to the usual amount"
          />
        )}
        <TextField
          label="Note (optional)"
          value={note}
          onChange={event => setNote(event.target.value)}
          slotProps={{ htmlInput: { maxLength: LIMITS.MAX_NOTE } }}
        />
      </Stack>
    </FormDialog>
  );
}
