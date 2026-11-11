/**
 * Adding or editing a bill (or income): what it is, how much, and how often.
 * Editing the amount or the schedule asks from when: what's before keeps
 * its occurrences (core's save_item with a change), unless it hasn't started yet.
 */

import { useRef, useState } from 'react';
import { Alert, FormControlLabel, MenuItem, Stack, Switch, TextField } from '@mui/material';
import type { ItemKind, ItemView, Repeat } from '@budgetmint/contracts';
import { LIMITS } from '@budgetmint/contracts';
import { useBudgetChange } from '../../data/BudgetContext';
import { ordinal } from '../../utils/describe';
import { centsToInput, parseDollars } from '../../utils/money';
import { FormDialog } from '../ui/dialogs/FormDialog';
import { CurrencyInput } from '../ui/forms/CurrencyInput';

type Every = Repeat['every'];

const EVERY_LABELS: Record<Every, string> = {
  once: 'Once',
  days: 'Days',
  weeks: 'Weeks',
  months: 'Months',
  years: 'Years',
};

/** The reminder choices: days before it's due. */
const LEAD_CHOICES = [0, 1, 2, 3, 5, 7, 14];

/** The choices, with the one set now when it isn't among them (core allows any up to 30). */
export const leadChoices = (current: number) => [...new Set([...LEAD_CHOICES, current])].sort((a, b) => a - b);

export const leadLabel = (days: number) =>
  days === 0 ? 'On the day' : days === 1 ? '1 day before' : `${days} days before`;

const NOUNS: Record<ItemKind, string> = { bill: 'bill', income: 'income' };

function repeatOf(every: Every, n: number, day: number): Repeat {
  switch (every) {
    case 'once':
      return { every };
    case 'months':
      return { every, n, day };
    default:
      return { every, n };
  }
}

/** Whether two repeats are the same (field by field: core's JSON has its keys in its own order). */
export function sameRepeat(a: Repeat, b: Repeat): boolean {
  const n = (repeat: Repeat) => ('n' in repeat ? repeat.n : 0);
  const day = (repeat: Repeat) => (repeat.every === 'months' ? repeat.day : 0);
  return a.every === b.every && n(a) === n(b) && day(a) === day(b);
}

export interface ItemDialogProps {
  kind: ItemKind;
  /** The one being edited, as core lists it; none to add one. */
  view?: ItemView;
  today: string;
  /** Lead days a new item's reminder starts with. */
  defaultLeadDays: number;
  onClose: () => void;
}

export function ItemDialog({ kind, view, today, defaultLeadDays, onClose }: ItemDialogProps) {
  const change = useBudgetChange();
  const item = view?.item;
  // The part of its schedule in force today (core's)
  const segment = view?.current ?? null;
  const [name, setName] = useState(item?.name ?? '');
  const [amount, setAmount] = useState(centsToInput(segment?.amountCents ?? null));
  const [every, setEvery] = useState<Every>(segment?.repeat.every ?? 'months');
  const [n, setN] = useState(String(segment && 'n' in segment.repeat ? segment.repeat.n : 1));
  const [from, setFrom] = useState(segment?.from ?? today);
  const [day, setDay] = useState(segment?.repeat.every === 'months' ? segment.repeat.day : Number(today.slice(8, 10)));
  const [changeFrom, setChangeFrom] = useState(today);
  const [category, setCategory] = useState(item?.category ?? '');
  const [autopay, setAutopay] = useState(item?.autopay ?? false);
  const [reminded, setReminded] = useState(item ? item.reminder !== null : kind === 'bill');
  const firstLead = item?.reminder?.leadDays[0] ?? defaultLeadDays;
  const [lead, setLead] = useState(firstLead);
  const [note, setNote] = useState(item?.note ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  /** A field left wrong: said under it, and focus goes to it. */
  const [wrong, setWrong] = useState<{ field: 'amount' | 'changeFrom'; message: string } | null>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const changeFromInput = useRef<HTMLInputElement>(null);
  const refuse = (field: 'amount' | 'changeFrom', message: string) => {
    setProblem(null);
    setWrong({ field, message });
    (field === 'amount' ? amountInput : changeFromInput).current?.focus();
  };

  const cents = parseDollars(amount);
  const repeat = repeatOf(every, Number(n), day);
  // Started already: a change applies from a date, and what's before stays
  const started = view?.started ?? false;
  const scheduleChanged =
    segment !== null &&
    (cents !== segment.amountCents || !sameRepeat(repeat, segment.repeat) || (!started && from !== segment.from));

  const submit = () => {
    if (cents === null) {
      refuse('amount', 'Enter the amount');
      return;
    }
    setWrong(null);
    const base = {
      id: item?.id ?? crypto.randomUUID(),
      kind,
      name,
      category: category || null,
      autopay,
      // Left as it was, the reminder keeps every day it had (another device may have set several)
      reminder: reminded ? { leadDays: item?.reminder && lead === firstLead ? item.reminder.leadDays : [lead] } : null,
      archived: item?.archived ?? false,
      note: note || null,
    };
    const newSchedule = [{ from, until: null, repeat, amountCents: cents }];
    const saved = `${name.trim()} ${item ? 'saved' : 'added'}`;
    try {
      if (item && scheduleChanged && started) {
        if (!changeFrom) {
          refuse('changeFrom', 'Choose the date the change starts on');
          return;
        }
        // One change: the item's fields and its schedule from that date, or neither
        change(
          'save_item',
          {
            item: { ...base, schedule: item.schedule },
            change: { from: changeFrom, repeat, amountCents: cents },
            edit: true,
          },
          saved
        );
      } else {
        change(
          'save_item',
          // An edit is refused if the item was deleted (on another device) meanwhile
          {
            item: { ...base, schedule: scheduleChanged || !item ? newSchedule : item.schedule },
            edit: item !== undefined,
          },
          saved
        );
      }
    } catch (error) {
      setProblem((error as Error).message);
      return;
    }
    onClose();
  };

  return (
    <FormDialog onClose={onClose} title={item ? `Edit ${item.name}` : `Add ${NOUNS[kind]}`} onSubmit={submit}>
      <Stack spacing={2}>
        {problem && <Alert severity="error">{problem}</Alert>}
        <TextField
          label="Name"
          value={name}
          onChange={event => setName(event.target.value)}
          autoFocus
          slotProps={{ htmlInput: { maxLength: LIMITS.MAX_NAME } }}
        />
        <CurrencyInput
          label="Amount"
          value={amount}
          onChange={setAmount}
          error={wrong?.field === 'amount'}
          helperText={wrong?.field === 'amount' ? wrong.message : undefined}
          inputRef={amountInput}
        />
        {/* One under the other on a phone, where "Every how many months" doesn't fit beside it */}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label="Repeats"
            value={every}
            onChange={event => setEvery(event.target.value as Every)}
            sx={{ flex: 1 }}
          >
            {(Object.keys(EVERY_LABELS) as Every[]).map(value => (
              <MenuItem key={value} value={value}>
                {value === 'once' ? 'Once' : `Every… ${EVERY_LABELS[value].toLowerCase()}`}
              </MenuItem>
            ))}
          </TextField>
          {every !== 'once' && (
            <TextField
              label={`Every how many ${EVERY_LABELS[every].toLowerCase()}`}
              type="number"
              value={n}
              onChange={event => setN(event.target.value)}
              sx={{ flex: 1 }}
              slotProps={{ htmlInput: { min: 1 } }}
            />
          )}
        </Stack>
        {every === 'months' && (
          <TextField select label="On day" value={day} onChange={event => setDay(Number(event.target.value))}>
            {Array.from({ length: 31 }, (_, index) => index + 1).map(value => (
              <MenuItem key={value} value={value}>
                {value === 31 ? 'The last day' : `The ${ordinal(value)}`}
              </MenuItem>
            ))}
          </TextField>
        )}
        {!started && (
          <TextField
            label={every === 'once' ? 'On' : 'First on'}
            type="date"
            value={from}
            onChange={event => setFrom(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        )}
        {started && scheduleChanged && (
          <TextField
            label="The change starts on"
            type="date"
            value={changeFrom}
            onChange={event => setChangeFrom(event.target.value)}
            inputRef={changeFromInput}
            error={wrong?.field === 'changeFrom'}
            helperText={
              wrong?.field === 'changeFrom'
                ? wrong.message
                : `Before then, it stays as it was.${every === 'weeks' ? ' It repeats on that day of the week.' : ''}`
            }
            slotProps={{ inputLabel: { shrink: true } }}
          />
        )}
        <TextField
          label="Category (optional)"
          value={category}
          onChange={event => setCategory(event.target.value)}
          slotProps={{ htmlInput: { maxLength: LIMITS.MAX_CATEGORY } }}
        />
        <FormControlLabel
          control={<Switch checked={autopay} onChange={event => setAutopay(event.target.checked)} />}
          label={kind === 'bill' ? 'Paid automatically (autopay)' : 'Comes in automatically'}
        />
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <FormControlLabel
            control={<Switch checked={reminded} onChange={event => setReminded(event.target.checked)} />}
            label="Remind me"
          />
          {reminded && (
            <TextField
              select
              size="small"
              label="When"
              value={lead}
              onChange={event => setLead(Number(event.target.value))}
              sx={{ minWidth: 180 }}
            >
              {leadChoices(lead).map(value => (
                <MenuItem key={value} value={value}>
                  {leadLabel(value)}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Stack>
        <TextField
          label="Note (optional)"
          value={note}
          onChange={event => setNote(event.target.value)}
          multiline
          minRows={2}
          slotProps={{ htmlInput: { maxLength: LIMITS.MAX_NOTE } }}
        />
      </Stack>
    </FormDialog>
  );
}
