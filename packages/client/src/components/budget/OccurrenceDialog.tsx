/**
 * One occurrence of a bill or income: paid (when, how much), skipped, or
 * still to come; this time's amount, its due date, and a note.
 */

import { useState } from 'react';
import { Alert, FormControlLabel, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import type { OccStatus, OccurrenceView } from '@budgetmint/contracts';
import { LIMITS } from '@budgetmint/contracts';
import { useBudgetChange } from '../../data/BudgetContext';
import { formatDay } from '../../utils/dates';
import { centsToInput, formatCents, parseDollars } from '../../utils/money';
import { FormDialog } from '../ui/dialogs/FormDialog';
import { CurrencyInput } from '../ui/forms/CurrencyInput';

type State = OccStatus['state'];

export function OccurrenceDialog({
  occurrence,
  today,
  onClose,
}: {
  occurrence: OccurrenceView;
  today: string;
  onClose: () => void;
}) {
  const change = useBudgetChange();
  const status = occurrence.status;
  const bill = occurrence.kind === 'bill';
  const [state, setState] = useState<State>(status.state);
  const [paidOn, setPaidOn] = useState(
    status.state === 'done' ? status.on : occurrence.due < today ? occurrence.due : today
  );
  const [paid, setPaid] = useState(
    centsToInput(status.state === 'done' ? status.amountCents : occurrence.expectedCents)
  );
  const [expected, setExpected] = useState(centsToInput(occurrence.expectedCents));
  const [due, setDue] = useState(occurrence.due);
  const [note, setNote] = useState(occurrence.note ?? '');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = () => {
    const paidCents = parseDollars(paid);
    const expectedCents = parseDollars(expected);
    if (expectedCents === null || (state === 'done' && paidCents === null)) {
      setProblem('Enter the amount');
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
            // Only what differs from the schedule is kept
            amountCents: expectedCents === occurrence.expectedCents && !occurrence.changed ? null : expectedCents,
            movedTo: due === occurrence.scheduled ? null : due,
            note: note || null,
          },
        },
        `${occurrence.name} saved`
      );
    } catch (error) {
      setProblem((error as Error).message);
      return;
    }
    onClose();
  };

  return (
    <FormDialog onClose={onClose} title={`${occurrence.name}, ${formatDay(occurrence.scheduled)}`} onSubmit={submit}>
      <Stack spacing={2}>
        {problem && <Alert severity="error">{problem}</Alert>}
        <Typography variant="body2" color="text.secondary">
          {formatCents(occurrence.expectedCents)} due {formatDay(occurrence.due)}
          {occurrence.autopay ? ', on autopay' : ''}
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
            <CurrencyInput label="Amount" value={paid} onChange={setPaid} error={false} sx={{ flex: 1 }} />
          </Stack>
        )}
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
            <CurrencyInput label="This time" value={expected} onChange={setExpected} error={false} sx={{ flex: 1 }} />
          </Stack>
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
