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
 *   own, or matched by hand to a bill or income still open. They stay in the
 *   order they were read in: choosing a category moves nothing;
 * - the statement's closing balance, to take.
 *
 * Money out is written below zero ("-$4.50") and money in with a plus. A
 * statement that writes what was spent above zero (a card's, often) is read
 * the other way round with a switch; a CSV's columns can be chosen again
 * when core took the wrong ones, and are asked for when it can't tell them.
 *
 * Saving keeps every line (core's import_statement), as one change with
 * Undo; lines kept from a statement before are left as they are. With more
 * than one bank account, it's one account's statement, chosen at the top:
 * it's matched to what's in that account, and settles that one.
 */

import { useId, useState } from 'react';
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

type ColumnKey = 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'kind';

const COLUMN_LABELS: Record<ColumnKey, string> = {
  date: 'Date',
  description: 'Description',
  amount: 'Amount (out below zero)',
  debit: 'Or money out',
  credit: 'And money in',
  kind: 'Says which way (debit or credit)',
};

/** Which columns hold what, chosen from the CSV's header: the date and an amount at least. */
function ColumnChooser({
  headers,
  found,
  onRead,
  onBack,
}: {
  headers: string[];
  /** The columns core took, to start from: none when it couldn't tell them. */
  found: CsvColumns | null;
  onRead: (columns: CsvColumns) => void;
  /** Leaves them as they were read (when they were). */
  onBack?: () => void;
}) {
  const [chosen, setChosen] = useState<Partial<Record<ColumnKey, number | null>>>(found ?? {});
  const at = (key: ColumnKey) => chosen[key] ?? null;
  const ready = at('date') !== null && [at('amount'), at('debit'), at('credit')].some(column => column !== null);
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        {found
          ? 'Which of this file’s columns hold what?'
          : 'BudgetMint can’t tell this file’s columns apart. Which hold what?'}
      </Alert>
      {(Object.keys(COLUMN_LABELS) as ColumnKey[]).map(key => (
        <TextField
          key={key}
          select
          size="small"
          label={COLUMN_LABELS[key]}
          value={at(key) ?? ''}
          onChange={event =>
            setChosen(current => ({
              ...current,
              [key]: event.target.value === '' ? null : Number(event.target.value),
            }))
          }
        >
          <MenuItem value="">
            <em>None</em>
          </MenuItem>
          {headers.map((header, column) => (
            <MenuItem key={`${column} ${header}`} value={column}>
              {header || `Column ${column + 1}`}
            </MenuItem>
          ))}
        </TextField>
      ))}
      <Stack direction="row" sx={{ gap: 1 }}>
        <Button
          variant="outlined"
          disabled={!ready}
          onClick={() =>
            onRead({
              date: at('date')!,
              description: at('description'),
              amount: at('amount'),
              debit: at('debit'),
              credit: at('credit'),
              // The balance column stays the one core found
              balance: found?.balance ?? null,
              kind: at('kind'),
            })
          }
        >
          Read it
        </Button>
        {onBack && (
          <Button color="secondary" onClick={onBack}>
            Leave them as they were
          </Button>
        )}
      </Stack>
    </Stack>
  );
}

/**
 * A category, picked from the ones in use or typed (any name will do). What's
 * typed is taken when the field is left, Enter is pressed or one is picked
 * (and at once when it's emptied), not letter by letter: nothing around it
 * changes while it's being typed.
 */
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
  const [typed, setTyped] = useState(value);
  // Changed from outside (the merchant's, for one of its lines): shown
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setTyped(value);
  }
  const take = (category: string) => category !== value && onChange(category);
  return (
    <Autocomplete
      freeSolo
      size="small"
      options={options}
      inputValue={typed}
      // Emptied, it has none at once: there's nothing more to type
      onInputChange={(_event, text) => {
        setTyped(text);
        if (text === '') take('');
      }}
      // Picked or entered
      onChange={(_event, picked) => take(picked ?? '')}
      onBlur={() => take(typed)}
      sx={{ flex: 1, minWidth: 160 }}
      renderInput={params => (
        <TextField
          {...params}
          label={label}
          placeholder="Pick one or type your own"
          slotProps={{
            ...params.slotProps,
            htmlInput: { ...params.slotProps.htmlInput, maxLength: LIMITS.MAX_CATEGORY },
          }}
        />
      )}
    />
  );
}

/** Money out below zero ("-$4.50"), money in with a plus ("+$4.50"). */
const signed = (cents: number) => `${cents > 0 ? '+' : ''}${formatCents(cents)}`;
/** Money in is green as well as plus. */
const toneOf = (cents: number) => (cents > 0 ? 'success.main' : 'text.primary');
const NO_CATEGORY = 'No category';
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
  /** The merchants without a category when only those were asked for: one given a category since stays in view. */
  const [onlyBare, setOnlyBare] = useState<string[] | null>(null);
  /** The columns chosen here (none: the ones core finds), and whether they're being chosen. */
  const [columns, setColumns] = useState<CsvColumns | null>(null);
  const [choosing, setChoosing] = useState(false);
  /** The statement writes money out above zero: read the other way round. */
  const [reversed, setReversed] = useState(false);
  const linesId = useId();
  /** Escape was pressed with something to save: asking before it's dropped. */
  const [asking, setAsking] = useState(false);
  const dirty = useDirty([unticked, takeBalance, pays, chosen, own, adding, drafts]);

  /** Reads it again, another way: what was chosen by its lines' places starts over. */
  const read = (next: { columns?: CsvColumns | null; account?: string; reversed?: boolean }) => {
    const given = next.columns === undefined ? columns : next.columns;
    try {
      setView(
        core.call('read_statement', {
          texts,
          columns: given ?? undefined,
          accountId: next.account ?? accountId,
          reversed: next.reversed ?? reversed,
        })
      );
      setProblem(null);
    } catch (error) {
      setProblem((error as Error).message);
      return;
    }
    setColumns(given);
    setChoosing(false);
    setUnticked([]);
    setPays({});
    setOwn({});
    setAdding([]);
    setOnlyBare(null);
  };
  /** Another account's: read again against what's in that one. */
  const choose = (account: string) => {
    setAccountId(account);
    setPicked(true);
    read({ account });
  };
  const turn = (other: boolean) => {
    setReversed(other);
    read({ reversed: other });
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

  // By who each was paid to, in the order the statement gives them: what
  // it has no category for first, then the most money. A category chosen
  // here moves none of them
  const groups = [...new Set(lines.map(line => line.merchant))]
    .map(merchant => {
      const its = lines.filter(line => line.merchant === merchant);
      const who = merchant || 'No description';
      return {
        merchant,
        its,
        category: chosen[merchant] ?? its[0].category ?? '',
        // Still to file: any of its lines without a category
        bare: its.some(line => categoryOf(line) === ''),
        unfiled: its.some(line => !line.category),
        cents: sum(its),
        who,
        title: its.length > 1 ? `${who} (${its.length})` : who,
      };
    })
    .sort((a, b) => Number(b.unfiled) - Number(a.unfiled) || Math.abs(b.cents) - Math.abs(a.cents));
  const bare = groups.filter(group => group.bare);
  const shown = onlyBare ? groups.filter(group => onlyBare.includes(group.merchant)) : groups;
  // Every category there is to pick, each once however it's spelled (as a bill spells it, first)
  const options = [
    ...new Map(
      [
        ...inUse,
        ...view.transactions.flatMap(line => (line.category ? [line.category] : [])),
        ...Object.values(chosen),
        ...Object.values(own).flatMap(line => line.category ?? []),
      ]
        .filter(Boolean)
        .reverse()
        .map(category => [category.toLowerCase(), category])
    ).values(),
  ].sort((a, b) => a.localeCompare(b));
  // What was spent, by category as it stands
  const totals = new Map<string, number>();
  for (const line of fresh.filter(line => line.flow === 'spend')) {
    const category = categoryOf(line) || NO_CATEGORY;
    totals.set(category, (totals.get(category) ?? 0) - line.amountCents);
  }
  // What goes out and what comes in, of the lines new here
  const ways = fresh.filter(line => line.flow === 'spend' || line.flow === 'income');
  const out = ways.filter(line => line.amountCents < 0);
  const into = ways.filter(line => line.amountCents > 0);

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
          {!picked ? null : view.format === 'csv' && (view.columns === null || choosing) ? (
            <ColumnChooser
              headers={view.headers}
              found={view.columns}
              onRead={chosen => read({ columns: chosen })}
              onBack={view.columns ? () => setChoosing(false) : undefined}
            />
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
                  // Which way the money went: how many out and in, and what they come to
                  ways.length > 0 &&
                    `${[
                      out.length > 0 && `${out.length} out (${signed(sum(out))})`,
                      into.length > 0 && `${into.length} in (${signed(sum(into))})`,
                    ]
                      .filter(Boolean)
                      .join(', ')}.`,
                ]
                  .filter(Boolean)
                  .join(' ')}
              </Typography>
              {view.allIn && !reversed && (
                <Alert severity="info">
                  Every amount here reads as money in. If these are what you spent (a card’s statement often writes them
                  so), switch on “Amounts are the other way round”.
                </Alert>
              )}
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <FormControlLabel
                  control={<Switch checked={reversed} onChange={event => turn(event.target.checked)} />}
                  label="Amounts are the other way round"
                />
                {view.format === 'csv' && (
                  <Button size="small" onClick={() => setChoosing(true)}>
                    Choose the columns
                  </Button>
                )}
              </Stack>
              {view.matches.length > 0 ? (
                <FormGroup role="group" aria-label="Bills and income it shows paid">
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
                        label={`${occurrence.name}, due ${formatDay(occurrence.due)}: ${signed(transaction.amountCents)} on ${formatDay(transaction.date)}${match.exact ? '' : ` (expected ${formatCents(occurrence.expectedCents)})`}`}
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
                  <Stack
                    direction="row"
                    sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      The rest, by who it was paid to
                    </Typography>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={onlyBare !== null}
                          onChange={event =>
                            setOnlyBare(event.target.checked ? bare.map(group => group.merchant) : null)
                          }
                        />
                      }
                      label={`Only what has no category (${bare.length})`}
                    />
                  </Stack>
                  {shown.map(({ merchant, its, category, cents, who, title }, place) => (
                    <Stack key={merchant} spacing={1} role="group" aria-label={who}>
                      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Button
                          size="small"
                          color="inherit"
                          aria-expanded={opened === merchant}
                          aria-controls={opened === merchant ? `${linesId}-${place}` : undefined}
                          aria-label={`${title} ${signed(cents)}`}
                          onClick={() => setOpened(current => (current === merchant ? null : merchant))}
                          sx={{ flex: 2, minWidth: 200, justifyContent: 'space-between', textAlign: 'left' }}
                        >
                          <span>{title}</span>
                          <Box component="span" sx={{ fontFamily: MONO, pl: 1, color: toneOf(cents) }}>
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
                      {opened === merchant && (
                        <Stack id={`${linesId}-${place}`} spacing={1.5} sx={{ pl: 2 }}>
                          {its.map(line => {
                            const about = `${formatDay(line.date)}, ${signed(line.amountCents)}`;
                            const open = view.open.filter(
                              open => wayOf(open) === (line.amountCents < 0 ? 'out' : 'in')
                            );
                            return (
                              // Each line's day and amount stand over its fields, and name them
                              <Stack key={line.index} spacing={1} role="group" aria-label={about}>
                                <Typography variant="body2" sx={{ fontFamily: MONO, color: toneOf(line.amountCents) }}>
                                  {about}
                                </Typography>
                                <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                                  <TextField
                                    size="small"
                                    label="Name"
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
                                    label="Category"
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
                                      label="It paid"
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
                              </Stack>
                            );
                          })}
                        </Stack>
                      )}
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
                    // A to Z, what has none last: a chip keeps its place as the amounts change
                    .sort(([a], [b]) => (a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : a.localeCompare(b)))
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
