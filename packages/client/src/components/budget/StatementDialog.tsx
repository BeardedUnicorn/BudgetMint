/**
 * A bank statement (CSV or OFX) read and matched to the open bills and
 * income (core's read_statement): the user ticks the ones to mark paid, on
 * the day the bank shows and for its amount, and can take the statement's
 * closing balance too. When a CSV's columns can't be told, they're chosen
 * here. Saving is one change with Undo (core's settle, which also checks the
 * balance against what was expected).
 */

import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { CsvColumns, StatementView } from '@budgetmint/contracts';
import { useBudget, useBudgetChange } from '../../data/BudgetContext';
import { formatDay, formatDayInYear } from '../../utils/dates';
import { formatCents } from '../../utils/money';
import { ConfirmDialog } from '../ui/dialogs/ConfirmDialog';

type ColumnKey = 'date' | 'description' | 'amount' | 'debit' | 'credit';

const COLUMN_LABELS: Record<ColumnKey, string> = {
  date: 'Date',
  description: 'Description',
  amount: 'Amount (out below zero)',
  debit: 'Or money out',
  credit: 'And money in',
};

/** Which columns hold what, chosen from the CSV's header: the date and an amount at least. */
function ColumnChooser({ headers, onRead }: { headers: string[]; onRead: (columns: CsvColumns) => void }) {
  const [chosen, setChosen] = useState<Partial<Record<ColumnKey, number>>>({});
  const ready = chosen.date !== undefined && [chosen.amount, chosen.debit, chosen.credit].some(at => at !== undefined);
  return (
    <Stack spacing={2}>
      <Alert severity="info">BudgetMint can’t tell this file’s columns apart. Which hold what?</Alert>
      {(Object.keys(COLUMN_LABELS) as ColumnKey[]).map(key => (
        <TextField
          key={key}
          select
          size="small"
          label={COLUMN_LABELS[key]}
          value={chosen[key] ?? ''}
          onChange={event =>
            setChosen(current => ({
              ...current,
              [key]: event.target.value === '' ? undefined : Number(event.target.value),
            }))
          }
        >
          <MenuItem value="">
            <em>None</em>
          </MenuItem>
          {headers.map((header, at) => (
            <MenuItem key={`${at} ${header}`} value={at}>
              {header || `Column ${at + 1}`}
            </MenuItem>
          ))}
        </TextField>
      ))}
      <Button
        variant="outlined"
        disabled={!ready}
        onClick={() =>
          onRead({
            date: chosen.date!,
            description: chosen.description ?? null,
            amount: chosen.amount ?? null,
            debit: chosen.debit ?? null,
            credit: chosen.credit ?? null,
            balance: null,
          })
        }
      >
        Read it
      </Button>
    </Stack>
  );
}

export function StatementDialog({
  text,
  first,
  onClose,
}: {
  /** The file's text. */
  text: string;
  /** What core read of it first (without columns chosen). */
  first: StatementView;
  onClose: () => void;
}) {
  const { core } = useBudget();
  const change = useBudgetChange();
  const [view, setView] = useState(first);
  /** The matches left unticked, by transaction. */
  const [unticked, setUnticked] = useState<number[]>([]);
  const [takeBalance, setTakeBalance] = useState(view.balance !== null);
  const [problem, setProblem] = useState<string | null>(null);
  /** Escape was pressed with something to save: asking before it's dropped. */
  const [asking, setAsking] = useState(false);

  const read = (columns: CsvColumns) => {
    try {
      setView(core.call('read_statement', { text, columns }));
      setProblem(null);
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  const chosen = view.matches.filter(match => !unticked.includes(match.transaction));
  const balance = takeBalance ? view.balance : null;
  const matchedOrDone = new Set([...view.matches.map(match => match.transaction), ...view.already]);
  const others = view.transactions.filter(transaction => !matchedOrDone.has(transaction.index)).length;
  const dates = view.transactions.map(transaction => transaction.date).sort();

  const save = () => {
    try {
      change(
        'settle',
        {
          paid: chosen.map(match => {
            const transaction = view.transactions[match.transaction];
            return {
              itemId: match.occurrence.itemId,
              date: match.occurrence.scheduled,
              on: transaction.date,
              amountCents: Math.abs(transaction.amountCents),
            };
          }),
          balance: balance ?? undefined,
        },
        'Statement imported'
      );
    } catch (error) {
      setProblem((error as Error).message);
      return;
    }
    onClose();
  };

  return (
    <Dialog
      open
      // A click outside doesn't close it; Escape asks first while there's something to save
      onClose={(_event, reason) => {
        if (reason === 'backdropClick') return;
        if (chosen.length > 0 || balance !== null) setAsking(true);
        else onClose();
      }}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Bank statement</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {problem && <Alert severity="error">{problem}</Alert>}
          {view.columns === null && view.format === 'csv' ? (
            <ColumnChooser headers={view.headers} onRead={read} />
          ) : (
            <>
              <Typography variant="body2">
                {view.transactions.length === 0
                  ? 'No transactions in it.'
                  : `${view.transactions.length} transactions, ${formatDayInYear(dates[0])} to ${formatDayInYear(dates[dates.length - 1])}.`}
                {view.skippedRows > 0 && ` ${view.skippedRows} lines didn’t read as one.`}
              </Typography>
              {view.matches.length > 0 ? (
                <FormGroup aria-label="Bills and income it shows paid">
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Mark these paid (or received)?
                  </Typography>
                  {view.matches.map(match => {
                    const transaction = view.transactions[match.transaction];
                    const { occurrence } = match;
                    return (
                      <FormControlLabel
                        key={match.transaction}
                        control={
                          <Checkbox
                            checked={!unticked.includes(match.transaction)}
                            onChange={event =>
                              setUnticked(current =>
                                event.target.checked
                                  ? current.filter(at => at !== match.transaction)
                                  : [...current, match.transaction]
                              )
                            }
                          />
                        }
                        label={`${occurrence.name}, due ${formatDay(occurrence.due)}: ${formatCents(Math.abs(transaction.amountCents))} on ${formatDay(transaction.date)}${match.exact ? '' : ` (expected ${formatCents(occurrence.expectedCents)})`}`}
                      />
                    );
                  })}
                </FormGroup>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  None of it matches a bill or income still open.
                </Typography>
              )}
              {(view.already.length > 0 || others > 0) && (
                <Typography variant="caption" color="text.secondary">
                  {[
                    view.already.length > 0 && `${view.already.length} marked paid already`,
                    others > 0 && `${others} that aren’t bills or income in BudgetMint`,
                  ]
                    .filter(Boolean)
                    .join('; ')}
                  .
                </Typography>
              )}
              {view.balance && (
                <FormControlLabel
                  control={<Checkbox checked={takeBalance} onChange={event => setTakeBalance(event.target.checked)} />}
                  label={`Set your balance to ${formatCents(view.balance.cents)}, as of the end of ${formatDayInYear(view.balance.asOf)}`}
                />
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="secondary">
          Cancel
        </Button>
        <Button variant="contained" onClick={save} disabled={chosen.length === 0 && balance === null}>
          Save
        </Button>
      </DialogActions>
      <ConfirmDialog
        open={asking}
        onClose={() => setAsking(false)}
        onConfirm={onClose}
        title="Leave the statement unsaved?"
        message="Nothing it matched is marked paid until you save."
        confirmLabel="Discard"
        cancelLabel="Keep going"
        severity="error"
      />
    </Dialog>
  );
}
