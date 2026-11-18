/**
 * A bank statement (CSV or OFX: one file, or several months' as one) read by
 * core (read_statement) and gone through before it's saved:
 *
 * - the bills and income it shows paid, ticked to mark them so, on the day
 *   the bank shows and for its amount;
 * - the charges and income that come round and aren't in BudgetMint yet,
 *   ticked to add them as bills or income (Edit opens the bill's form first);
 * - everything else, by who it was paid to, each with the category core
 *   suggests: changed for a merchant, it's remembered for the statements to
 *   come; opened, each of its lines can be renamed, put in a category of its
 *   own, or matched by hand to a bill or income still open;
 * - the statement's closing balance, to take.
 *
 * Saving keeps every line (core's import_statement), as one change with
 * Undo; lines kept from a statement before are left as they are. When a
 * CSV's columns can't be told, they're chosen here. With more than one bank
 * account, it's one account's statement, chosen at the top: it's matched to
 * what's in that account, and settles that one.
 */

import { useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import type {
  BankTransaction,
  CsvColumns,
  ItemInput,
  PaidInput,
  RecurringFound,
  StatementView,
} from '@budgetmint/contracts';
import { LIMITS, MAIN_ACCOUNT } from '@budgetmint/contracts';
import { useAccounts, useBudget, useBudgetChange, useCoreQuery } from '../../data/BudgetContext';
import { formatDay, formatDayInYear } from '../../utils/dates';
import { describeRepeat } from '../../utils/describe';
import { formatCents } from '../../utils/money';
import { useBackDismiss } from '../../contexts/NavigationContext';
import { useDirty } from '../../hooks/useDirty';
import { MONO } from '../../theme/layout';
import { categoriesOf } from '../pages/items/ItemFilters';
import { ConfirmDialog } from '../ui/dialogs/ConfirmDialog';
import { AccountField } from './AccountField';
import { ItemDialog } from './ItemDialog';

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

/** A category, typed or picked from the ones in use. */
function CategoryField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (category: string) => void;
}) {
  return (
    <Autocomplete
      freeSolo
      size="small"
      options={options}
      inputValue={value}
      // (It also says so when nothing changed: when it's first shown)
      onInputChange={(_event, typed) => typed !== value && onChange(typed)}
      sx={{ flex: 1, minWidth: 160 }}
      renderInput={params => (
        <TextField
          {...params}
          label={label}
          slotProps={{
            ...params.slotProps,
            htmlInput: { ...params.slotProps.htmlInput, maxLength: LIMITS.MAX_CATEGORY },
          }}
        />
      )}
    />
  );
}

const signed = (cents: number) => `${cents < 0 ? '' : '+'}${formatCents(Math.abs(cents))}`;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const sum = (lines: BankTransaction[]) => lines.reduce((total, line) => total + line.amountCents, 0);

export function StatementDialog({
  texts,
  first,
  onClose,
}: {
  /** Each file's text. */
  texts: string[];
  /** What core read of them first (without columns chosen). */
  first: StatementView;
  onClose: () => void;
}) {
  const { core } = useBudget();
  const change = useBudgetChange();
  const { today } = useCoreQuery('get_overview');
  const { settings } = useCoreQuery('get_settings');
  const inUse = categoriesOf(useCoreQuery('get_items'));
  const [view, setView] = useState(first);
  /** Whose statement it is (the first read took it as the main account's). */
  const [accountId, setAccountId] = useState<string>(MAIN_ACCOUNT);
  const { several } = useAccounts();
  /** With several accounts it's asked first: taken as the main one's, a savings statement would set the wrong balance. */
  const [picked, setPicked] = useState(!several);
  /** The matches left unticked, by transaction. */
  const [unticked, setUnticked] = useState<number[]>([]);
  const [takeBalance, setTakeBalance] = useState(view.balance !== null);
  const [problem, setProblem] = useState<string | null>(null);
  /** The open bill or income a line was matched to by hand, by transaction. */
  const [pays, setPays] = useState<Record<number, string>>({});
  /** The category chosen for a merchant's lines, by merchant: remembered when saved. */
  const [chosen, setChosen] = useState<Record<string, string>>({});
  /** A line's own name or category, by transaction. */
  const [own, setOwn] = useState<Record<number, { name?: string; category?: string }>>({});
  /** The charges that come round ticked to add, by key; and the ones edited first. */
  const [adding, setAdding] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ItemInput>>({});
  const [editing, setEditing] = useState<RecurringFound | null>(null);
  /** The merchant whose lines are shown one by one. */
  const [opened, setOpened] = useState<string | null>(null);
  const [onlyBare, setOnlyBare] = useState(false);
  /** Escape was pressed with something to save: asking before it's dropped. */
  const [asking, setAsking] = useState(false);
  const dirty = useDirty([unticked, takeBalance, pays, chosen, own, adding, drafts]);

  const read = (columns: CsvColumns | null, account = accountId) => {
    try {
      setView(core.call('read_statement', { texts, columns: columns ?? undefined, accountId: account }));
      setProblem(null);
    } catch (error) {
      setProblem((error as Error).message);
    }
  };
  /** Another account's: read again against what's in that one, with nothing chosen yet. */
  const choose = (account: string) => {
    setAccountId(account);
    setPicked(true);
    setUnticked([]);
    setPays({});
    setAdding([]);
    read(view.columns, account);
  };

  const ticked = view.matches.filter(match => !unticked.includes(match.transaction));
  const balance = takeBalance ? view.balance : null;
  const matched = new Set(view.matches.map(match => match.transaction));
  // What's new to BudgetMint; the lines to go through are the money spent
  // and received that paid no bill here
  const fresh = view.transactions.filter(line => !line.stored);
  const lines = fresh.filter(
    line => (line.flow === 'spend' || line.flow === 'income') && !matched.has(line.index) && line.amountCents !== 0
  );
  const listed = new Set(lines.map(line => line.index));
  const rewards = fresh.filter(line => line.flow === 'reward');
  const moved = fresh.filter(line => line.flow === 'moved');
  const categoryOf = (line: BankTransaction) =>
    listed.has(line.index)
      ? (own[line.index]?.category ?? chosen[line.merchant] ?? line.category ?? '')
      : (line.category ?? '');
  const nameOf = (line: BankTransaction) => own[line.index]?.name ?? line.merchant;
  const keyOf = (occurrence: StatementView['open'][number]) => `${occurrence.itemId} ${occurrence.scheduled}`;
  /** Which way an open one's money goes in this account: a transfer, by which end it is. */
  const wayOf = (open: StatementView['open'][number]) =>
    open.kind === 'bill' || (open.kind === 'transfer' && open.accountId === accountId) ? 'out' : 'in';
  // Matched by hand
  const byHand = lines.flatMap(line => {
    const occurrence = view.open.find(open => keyOf(open) === pays[line.index]);
    return occurrence ? [{ line, occurrence }] : [];
  });
  const paid: PaidInput[] = [
    ...byHand,
    ...ticked.map(match => ({ line: view.transactions[match.transaction], occurrence: match.occurrence })),
  ].map(({ line, occurrence }) => ({
    itemId: occurrence.itemId,
    date: occurrence.scheduled,
    on: line.date,
    amountCents: Math.abs(line.amountCents),
  }));
  /** The bill or income each line paid, by transaction. */
  const paidBy = new Map([
    ...view.matches.map(match => [match.transaction, match.occurrence.itemId] as const),
    ...byHand.map(({ line, occurrence }) => [line.index, occurrence.itemId] as const),
  ]);

  // By who each was paid to: what has no category first, then the most money
  const groups = [...new Set(lines.map(line => line.merchant))]
    .map(merchant => {
      const its = lines.filter(line => line.merchant === merchant);
      const who = merchant || 'No description';
      return {
        merchant,
        its,
        category: chosen[merchant] ?? its[0].category ?? '',
        cents: sum(its),
        who,
        title: its.length > 1 ? `${who} (${its.length})` : who,
      };
    })
    .sort((a, b) => Number(a.category !== '') - Number(b.category !== '') || Math.abs(b.cents) - Math.abs(a.cents));
  const bare = groups.filter(group => group.category === '');
  const options = [
    ...new Set([
      ...inUse,
      ...view.transactions.flatMap(line => (line.category ? [line.category] : [])),
      ...Object.values(chosen).filter(Boolean),
    ]),
  ].sort((a, b) => a.localeCompare(b));
  // What was spent, by category as it stands
  const totals = new Map<string, number>();
  for (const line of fresh.filter(line => line.flow === 'spend')) {
    const category = categoryOf(line) || 'No category';
    totals.set(category, (totals.get(category) ?? 0) - line.amountCents);
  }

  /** A charge that comes round as the bill (or income) it would be added as. */
  const itemOf = (found: RecurringFound): ItemInput =>
    drafts[found.key] ?? {
      id: crypto.randomUUID(),
      kind: found.kind,
      name: found.name,
      category: found.category,
      schedule: [
        { from: found.from, until: null, repeat: found.repeat, amountCents: found.amountCents, weekends: 'keep' },
      ],
      autopay: false,
      reminder: found.kind === 'bill' ? { leadDays: [settings.reminders.leadDays] } : null,
      archived: false,
      note: null,
      varies: found.varies,
      saveUp: false,
      accountId,
    };
  const items = view.recurring.filter(found => adding.includes(found.key)).map(itemOf);
  const nothing = !picked || (fresh.length === 0 && paid.length === 0 && balance === null && items.length === 0);
  const dates = view.transactions.map(transaction => transaction.date).sort();

  const save = () => {
    try {
      change(
        'import_statement',
        {
          accountId,
          statement: {
            transactions: fresh.map(line => ({
              id: line.id,
              on: line.date,
              amountCents: line.amountCents,
              name: nameOf(line),
              category: categoryOf(line) || undefined,
              flow: line.flow,
              itemId: paidBy.get(line.index),
            })),
            paid,
            items,
            // What was chosen for a merchant is remembered for it
            rules: Object.entries(chosen).map(([merchant, category]) => ({ merchant, category })),
            balance: balance ?? undefined,
          },
        },
        'Statement imported'
      );
    } catch (error) {
      setProblem((error as Error).message);
      return;
    }
    onClose();
  };

  /** Escape or Back: asks first when something was chosen here, or is ticked to mark paid. */
  const leave = () => {
    if (nothing || (!dirty && ticked.length === 0)) return onClose();
    setAsking(true);
    return false;
  };
  useBackDismiss(true, leave);

  return (
    <Dialog
      open
      // A click outside doesn't close it
      onClose={(_event, reason) => reason !== 'backdropClick' && leave()}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>Bank statement</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {problem && <Alert severity="error">{problem}</Alert>}
          <AccountField
            label="Whose statement"
            value={picked ? accountId : ''}
            onChange={choose}
            helperText={picked ? undefined : 'Which account is this statement from?'}
            size="small"
          />
          {!picked ? null : view.columns === null && view.format === 'csv' ? (
            <ColumnChooser headers={view.headers} onRead={read} />
          ) : (
            <>
              <Typography variant="body2">
                {[
                  view.transactions.length === 0
                    ? 'No transactions in it.'
                    : `${count(view.transactions.length, 'transaction', 'transactions')}, ${formatDayInYear(dates[0])} to ${formatDayInYear(dates[dates.length - 1])}.`,
                  view.skippedRows > 0 && `${count(view.skippedRows, 'line', 'lines')} didn’t read as one.`,
                  view.pendingRows > 0 &&
                    `${count(view.pendingRows, 'isn’t', 'aren’t')} settled yet: left for a later statement.`,
                  fresh.length < view.transactions.length &&
                    `${count(view.transactions.length - fresh.length, 'is', 'are')} kept already, from a statement before.`,
                ]
                  .filter(Boolean)
                  .join(' ')}
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
              {view.already.length > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {view.already.length} marked paid already.
                </Typography>
              )}
              {view.recurring.length > 0 && (
                <FormGroup role="group" aria-label="What comes round">
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    These come round. Add them to your bills and income?
                  </Typography>
                  {view.recurring.map(found => {
                    const item = itemOf(found);
                    const [segment] = item.schedule;
                    return (
                      <Stack key={found.key} direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                        <FormControlLabel
                          sx={{ flex: 1 }}
                          control={
                            <Checkbox
                              checked={adding.includes(found.key)}
                              onChange={event =>
                                setAdding(current =>
                                  event.target.checked
                                    ? [...current, found.key]
                                    : current.filter(key => key !== found.key)
                                )
                              }
                            />
                          }
                          label={`${item.name}${found.kind === 'income' ? ' (income)' : ''}: ${item.varies ? 'about ' : ''}${formatCents(segment.amountCents)}, ${describeRepeat(segment.repeat, segment.from).toLowerCase()}, next ${formatDay(segment.from)}${item.category ? ` · ${item.category}` : ''}`}
                        />
                        <Button size="small" aria-label={`Edit ${item.name}`} onClick={() => setEditing(found)}>
                          Edit
                        </Button>
                      </Stack>
                    );
                  })}
                </FormGroup>
              )}
              {groups.length > 0 && (
                <Stack spacing={1} role="group" aria-label="What else it shows">
                  <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      The rest, by who it was paid to
                    </Typography>
                    <FormControlLabel
                      control={<Switch checked={onlyBare} onChange={event => setOnlyBare(event.target.checked)} />}
                      label={`Only what has no category (${bare.length})`}
                    />
                  </Stack>
                  {(onlyBare ? bare : groups).map(({ merchant, its, category, cents, who, title }) => (
                    <Stack key={merchant} spacing={1} role="group" aria-label={who}>
                      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Button
                          size="small"
                          color="inherit"
                          aria-expanded={opened === merchant}
                          aria-label={`${title} ${signed(cents)}`}
                          onClick={() => setOpened(current => (current === merchant ? null : merchant))}
                          sx={{ flex: 2, minWidth: 200, justifyContent: 'space-between', textAlign: 'left' }}
                        >
                          <span>{title}</span>
                          <Box component="span" sx={{ fontFamily: MONO, pl: 1 }}>
                            {signed(cents)}
                          </Box>
                        </Button>
                        <CategoryField
                          label={`Category for ${merchant || 'these'}`}
                          value={category}
                          options={options}
                          onChange={value => setChosen(current => ({ ...current, [merchant]: value }))}
                        />
                      </Stack>
                      {opened === merchant &&
                        its.map(line => {
                          const out = line.amountCents < 0;
                          const about = `${formatDay(line.date)}, ${signed(line.amountCents)}`;
                          const open = view.open.filter(open => wayOf(open) === (out ? 'out' : 'in'));
                          return (
                            <Stack key={line.index} direction="row" sx={{ gap: 1, flexWrap: 'wrap', pl: 2 }}>
                              <TextField
                                size="small"
                                label={`Name: ${about}`}
                                value={nameOf(line)}
                                onChange={event =>
                                  setOwn(current => ({
                                    ...current,
                                    [line.index]: { ...current[line.index], name: event.target.value },
                                  }))
                                }
                                helperText={line.description}
                                sx={{ flex: 2, minWidth: 200 }}
                                slotProps={{ htmlInput: { maxLength: LIMITS.MAX_NAME } }}
                              />
                              <CategoryField
                                label={`Category: ${about}`}
                                value={categoryOf(line)}
                                options={options}
                                onChange={value =>
                                  setOwn(current => ({
                                    ...current,
                                    [line.index]: { ...current[line.index], category: value },
                                  }))
                                }
                              />
                              {open.length > 0 && (
                                <TextField
                                  select
                                  size="small"
                                  label={`It paid: ${about}`}
                                  value={pays[line.index] ?? ''}
                                  onChange={event =>
                                    setPays(current => ({ ...current, [line.index]: event.target.value }))
                                  }
                                  sx={{ flex: 1, minWidth: 160 }}
                                >
                                  <MenuItem value="">No bill or income here</MenuItem>
                                  {open.map(open => (
                                    <MenuItem key={keyOf(open)} value={keyOf(open)}>
                                      {`${open.name}, due ${formatDay(open.due)}`}
                                    </MenuItem>
                                  ))}
                                </TextField>
                              )}
                            </Stack>
                          );
                        })}
                    </Stack>
                  ))}
                </Stack>
              )}
              {rewards.length > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {`${rewards.length} of cash back (${signed(sum(rewards))}): kept, and not counted as income.`}
                </Typography>
              )}
              {moved.length > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {`${moved.length} of your own money moved in or out (${signed(sum(moved))}): kept, and counted as neither spending nor income.`}
                </Typography>
              )}
              {totals.size > 0 && (
                <Stack direction="row" role="group" aria-label="Spent, by category" sx={{ gap: 1, flexWrap: 'wrap' }}>
                  {[...totals]
                    .sort((a, b) => b[1] - a[1])
                    .map(([category, cents]) => (
                      <Chip key={category} size="small" label={`${category}: ${formatCents(cents)}`} />
                    ))}
                </Stack>
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
        <Button onClick={() => void leave()} color="secondary">
          Cancel
        </Button>
        <Button variant="contained" onClick={save} disabled={nothing}>
          Save
        </Button>
      </DialogActions>
      <ConfirmDialog
        open={asking}
        onClose={() => setAsking(false)}
        onConfirm={onClose}
        title="Leave the statement unsaved?"
        message="Nothing of it is kept, or marked paid, until you save."
        confirmLabel="Discard"
        cancelLabel="Keep going"
        severity="error"
      />
      {editing && (
        <ItemDialog
          kind={editing.kind}
          today={today}
          defaultLeadDays={settings.reminders.leadDays}
          draft={{
            item: itemOf(editing),
            onDraft: item => {
              setDrafts(current => ({ ...current, [editing.key]: item }));
              setAdding(current => [...new Set([...current, editing.key])]);
            },
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </Dialog>
  );
}
