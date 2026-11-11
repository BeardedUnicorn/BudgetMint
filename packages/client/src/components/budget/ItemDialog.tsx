/**
 * Adding or editing a bill (or income): what it is, how much, how often
 * (twice a month and a weekday of the month too), where weekend dates go,
 * and (if it does) when it ends. Editing the amount or the schedule asks
 * from when: what's before keeps its occurrences (core's save_item with a
 * change), unless it hasn't started yet. The end is the schedule's last
 * part's: what comes after it doesn't happen. A varying amount is expected
 * at the average of the last few paid; a bill can have money set aside for
 * it a month at a time.
 */

import { useRef, useState } from 'react';
import { Alert, Autocomplete, Checkbox, FormControlLabel, MenuItem, Stack, Switch, TextField } from '@mui/material';
import type { ItemKind, ItemView, Repeat, Segment, Weekends } from '@budgetmint/contracts';
import { LIMITS } from '@budgetmint/contracts';
import { useBudgetChange, useCoreQuery } from '../../data/BudgetContext';
import { categoriesOf } from '../pages/items/ItemFilters';
import { parseDay } from '../../utils/dates';
import { ordinal, WEEKS_OF_MONTH, weekdayName } from '../../utils/describe';
import { centsToInput, parseDollars } from '../../utils/money';
import { FormDialog } from '../ui/dialogs/FormDialog';
import { CurrencyInput } from '../ui/forms/CurrencyInput';

type Every = Repeat['every'];

/** How each repeat reads in the menu, in its order there. */
const EVERY_CHOICES: Record<Every, string> = {
  once: 'Once',
  days: 'Every… days',
  weeks: 'Every… weeks',
  months: 'Every… months',
  twiceMonthly: 'Twice a month',
  monthWeekday: 'Monthly on a weekday',
  years: 'Every… years',
};

/** The unit "Every how many …" counts, for the repeats that have one. */
const EVERY_UNITS: Partial<Record<Every, string>> = {
  days: 'days',
  weeks: 'weeks',
  months: 'months',
  monthWeekday: 'months',
  years: 'years',
};

const WEEKEND_CHOICES: Record<Weekends, string> = {
  keep: 'Keep the date',
  before: 'Move to the Friday before',
  after: 'Move to the Monday after',
};

/** Repeats money can be set aside for: a month apart or more (core's rule). */
const SAVES_UP: Every[] = ['once', 'months', 'monthWeekday', 'years'];

const dayLabel = (value: number) => (value === 31 ? 'The last day' : `The ${ordinal(value)}`);

/** The reminder choices: days before it's due. */
const LEAD_CHOICES = [0, 1, 2, 3, 5, 7, 14];

/** The choices, with the ones set now when they aren't among them (core allows any up to 30). */
export const leadChoices = (...current: number[]) => [...new Set([...LEAD_CHOICES, ...current])].sort((a, b) => a - b);

export const leadLabel = (days: number) =>
  days === 0 ? 'On the day' : days === 1 ? '1 day before' : `${days} days before`;

const NOUNS: Record<ItemKind, string> = { bill: 'bill', income: 'income' };

/** The days, weeks and weekday a repeat may use besides how often. */
interface RepeatParts {
  n: number;
  day: number;
  second: number;
  week: number;
  weekday: number;
}

export function repeatOf(every: Every, { n, day, second, week, weekday }: RepeatParts): Repeat {
  switch (every) {
    case 'once':
      return { every };
    case 'months':
      return { every, n, day };
    case 'twiceMonthly':
      return { every, first: day, second };
    case 'monthWeekday':
      return { every, n, week, weekday };
    default:
      return { every, n };
  }
}

/** A repeat's parts, to edit (the day, week and weekday of `today` for those it hasn't). */
function partsOf(repeat: Repeat | undefined, today: string): RepeatParts {
  const day = Number(today.slice(8, 10));
  // Today's weekday, Monday 0 as core counts (Date's Sunday is 0)
  const weekday = (parseDay(today).getDay() + 6) % 7;
  const parts = { n: 1, day, second: Math.min(day + 15, 31), week: Math.min(Math.ceil(day / 7), 5), weekday };
  if (!repeat || repeat.every === 'once') return parts;
  if (repeat.every === 'twiceMonthly') return { ...parts, day: repeat.first, second: repeat.second };
  if (repeat.every === 'months') return { ...parts, n: repeat.n, day: repeat.day };
  if (repeat.every === 'monthWeekday') return { ...parts, n: repeat.n, week: repeat.week, weekday: repeat.weekday };
  return { ...parts, n: repeat.n };
}

/** Whether two repeats are the same (field by field: core's JSON has its keys in its own order). */
export function sameRepeat(a: Repeat, b: Repeat): boolean {
  const fields = (repeat: Repeat) => {
    const { every, ...rest } = repeat as Repeat & Record<string, number>;
    return [
      every,
      ...Object.keys(rest)
        .sort()
        .map(key => `${key}=${rest[key]}`),
    ].join(' ');
  };
  return fields(a) === fields(b);
}

/** `schedule` ending on `until` (none: going on), from its last part. */
const endingOn = (schedule: Segment[], until: string | null): Segment[] =>
  schedule.map((segment, index) => (index === schedule.length - 1 ? { ...segment, until } : segment));

type Field = 'amount' | 'changeFrom' | 'endsOn';

export interface ItemDialogProps {
  kind: ItemKind;
  /** The one being edited, as core lists it; none to add one. */
  view?: ItemView;
  today: string;
  /** Lead days a new item's reminder starts with. */
  defaultLeadDays: number;
  /** A savings goal to add: a bill once, saved up for. */
  goal?: boolean;
  onClose: () => void;
}

export function ItemDialog({ kind, view, today, defaultLeadDays, goal = false, onClose }: ItemDialogProps) {
  const change = useBudgetChange();
  // The categories already in use, offered as it's typed
  const categories = categoriesOf(useCoreQuery('get_items'));
  const item = view?.item;
  // The part of its schedule in force today (core's)
  const segment = view?.current ?? null;
  const [name, setName] = useState(item?.name ?? '');
  const [amount, setAmount] = useState(centsToInput(segment?.amountCents ?? null));
  const [every, setEvery] = useState<Every>(segment?.repeat.every ?? (goal ? 'once' : 'months'));
  const initial = partsOf(segment?.repeat, today);
  const [n, setN] = useState(String(initial.n));
  const [from, setFrom] = useState(segment?.from ?? today);
  const [day, setDay] = useState(initial.day);
  const [second, setSecond] = useState(initial.second);
  const [week, setWeek] = useState(initial.week);
  const [weekday, setWeekday] = useState(initial.weekday);
  const [weekends, setWeekends] = useState<Weekends>(segment?.weekends ?? 'keep');
  const [changeFrom, setChangeFrom] = useState(today);
  const lastUntil = item?.schedule.at(-1)?.until ?? null;
  const [ends, setEnds] = useState(lastUntil !== null);
  const [endsOn, setEndsOn] = useState(lastUntil ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [autopay, setAutopay] = useState(item?.autopay ?? false);
  const [reminded, setReminded] = useState(item ? item.reminder !== null : kind === 'bill');
  const [leads, setLeads] = useState<number[]>(item?.reminder?.leadDays ?? [defaultLeadDays]);
  const [note, setNote] = useState(item?.note ?? '');
  const [varies, setVaries] = useState(item?.varies ?? false);
  const [saveUp, setSaveUp] = useState(item ? item.saveUp !== null : goal);
  const [problem, setProblem] = useState<string | null>(null);
  /** A field left wrong: said under it, and focus goes to it. */
  const [wrong, setWrong] = useState<{ field: Field; message: string } | null>(null);
  const inputs = {
    amount: useRef<HTMLInputElement>(null),
    changeFrom: useRef<HTMLInputElement>(null),
    endsOn: useRef<HTMLInputElement>(null),
  };
  const refuse = (field: Field, message: string) => {
    setProblem(null);
    setWrong({ field, message });
    inputs[field].current?.focus();
  };
  const wrongAt = (field: Field) => (wrong?.field === field ? wrong.message : undefined);

  const cents = parseDollars(amount);
  // Twice a month: the first day before the last, the second after the first
  const firstDay = every === 'twiceMonthly' ? Math.min(day, 30) : day;
  const secondDay = Math.max(second, firstDay + 1);
  const repeat = repeatOf(every, { n: Number(n), day: firstDay, second: secondDay, week, weekday });
  const canSaveUp = kind === 'bill' && SAVES_UP.includes(every);
  // Started already: a change applies from a date, and what's before stays
  const started = view?.started ?? false;
  const scheduleChanged =
    segment !== null &&
    (cents !== segment.amountCents ||
      !sameRepeat(repeat, segment.repeat) ||
      weekends !== segment.weekends ||
      (!started && from !== segment.from));

  const submit = () => {
    if (cents === null) {
      refuse('amount', 'Enter the amount');
      return;
    }
    // Something that happens once has no end
    const ending = every !== 'once' && ends;
    if (ending && !endsOn) {
      refuse('endsOn', 'Choose the date it ends on');
      return;
    }
    const until = ending ? endsOn : null;
    setWrong(null);
    const base = {
      id: item?.id ?? crypto.randomUUID(),
      kind,
      name,
      category: category || null,
      autopay,
      // None chosen: no reminder (core's)
      reminder: reminded ? { leadDays: leads } : null,
      archived: item?.archived ?? false,
      note: note || null,
      varies,
      saveUp: canSaveUp && saveUp,
    };
    const newSchedule = [{ from, until, repeat, amountCents: cents, weekends }];
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
            change: { from: changeFrom, repeat, amountCents: cents, until: until ?? undefined, weekends },
            edit: true,
          },
          saved
        );
      } else {
        change(
          'save_item',
          // An edit is refused if the item was deleted (on another device) meanwhile
          {
            item: { ...base, schedule: scheduleChanged || !item ? newSchedule : endingOn(item.schedule, until) },
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
    <FormDialog
      onClose={onClose}
      title={item ? `Edit ${item.name}` : goal ? 'Add a savings goal' : `Add ${NOUNS[kind]}`}
      onSubmit={submit}
    >
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
          helperText={wrongAt('amount')}
          inputRef={inputs.amount}
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
            {(Object.keys(EVERY_CHOICES) as Every[]).map(value => (
              <MenuItem key={value} value={value}>
                {EVERY_CHOICES[value]}
              </MenuItem>
            ))}
          </TextField>
          {EVERY_UNITS[every] && (
            <TextField
              label={`Every how many ${EVERY_UNITS[every]}`}
              type="number"
              value={n}
              onChange={event => setN(event.target.value)}
              sx={{ flex: 1 }}
              slotProps={{ htmlInput: { min: 1 } }}
            />
          )}
        </Stack>
        {(every === 'months' || every === 'twiceMonthly') && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label={every === 'months' ? 'On day' : 'First on day'}
              value={firstDay}
              onChange={event => setDay(Number(event.target.value))}
              sx={{ flex: 1 }}
            >
              {Array.from({ length: every === 'months' ? 31 : 30 }, (_, index) => index + 1).map(value => (
                <MenuItem key={value} value={value}>
                  {dayLabel(value)}
                </MenuItem>
              ))}
            </TextField>
            {every === 'twiceMonthly' && (
              <TextField
                select
                label="Then on day"
                value={secondDay}
                onChange={event => setSecond(Number(event.target.value))}
                sx={{ flex: 1 }}
              >
                {Array.from({ length: 31 }, (_, index) => index + 1).map(value => (
                  <MenuItem key={value} value={value} disabled={value <= firstDay}>
                    {dayLabel(value)}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Stack>
        )}
        {every === 'monthWeekday' && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="On the"
              value={week}
              onChange={event => setWeek(Number(event.target.value))}
              sx={{ flex: 1 }}
            >
              {WEEKS_OF_MONTH.map((name, index) => (
                <MenuItem key={name} value={index + 1}>
                  {name[0].toUpperCase() + name.slice(1)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Day of the week"
              value={weekday}
              onChange={event => setWeekday(Number(event.target.value))}
              sx={{ flex: 1 }}
            >
              {Array.from({ length: 7 }, (_, index) => index).map(value => (
                <MenuItem key={value} value={value}>
                  {weekdayName(value)}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        )}
        {every !== 'days' && (
          <TextField
            select
            label="On a weekend"
            value={weekends}
            onChange={event => setWeekends(event.target.value as Weekends)}
            helperText={
              kind === 'bill' ? 'When it’s due on a Saturday or Sunday' : 'When it comes on a Saturday or Sunday'
            }
          >
            {(Object.keys(WEEKEND_CHOICES) as Weekends[]).map(value => (
              <MenuItem key={value} value={value}>
                {WEEKEND_CHOICES[value]}
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
            inputRef={inputs.changeFrom}
            error={wrong?.field === 'changeFrom'}
            helperText={
              wrongAt('changeFrom') ??
              `Before then, it stays as it was.${every === 'weeks' ? ' It repeats on that day of the week.' : ''}`
            }
            slotProps={{ inputLabel: { shrink: true } }}
          />
        )}
        {every !== 'once' && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
            <FormControlLabel
              control={<Switch checked={ends} onChange={event => setEnds(event.target.checked)} />}
              label="Ends"
            />
            {ends && (
              <TextField
                label="Last on or before"
                type="date"
                value={endsOn}
                onChange={event => setEndsOn(event.target.value)}
                inputRef={inputs.endsOn}
                error={wrong?.field === 'endsOn'}
                helperText={wrongAt('endsOn') ?? 'Nothing after this date'}
                sx={{ flex: 1 }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            )}
          </Stack>
        )}
        <Autocomplete
          freeSolo
          options={categories}
          inputValue={category}
          onInputChange={(_event, value) => setCategory(value)}
          renderInput={params => (
            <TextField
              {...params}
              label="Category (optional)"
              slotProps={{
                ...params.slotProps,
                htmlInput: { ...params.slotProps.htmlInput, maxLength: LIMITS.MAX_CATEGORY },
              }}
            />
          )}
        />
        <FormControlLabel
          control={<Switch checked={autopay} onChange={event => setAutopay(event.target.checked)} />}
          label={kind === 'bill' ? 'Paid automatically (autopay)' : 'Comes in automatically'}
        />
        <FormControlLabel
          control={<Switch checked={varies} onChange={event => setVaries(event.target.checked)} />}
          label={`The amount varies: expect the average of the last ${LIMITS.ESTIMATE_FROM} ${kind === 'bill' ? 'paid' : 'received'}`}
        />
        {canSaveUp && (
          <FormControlLabel
            control={<Switch checked={saveUp} onChange={event => setSaveUp(event.target.checked)} />}
            label={
              every === 'once'
                ? 'Save up for it: set some aside each month until then'
                : 'Set money aside for it each month, so it’s ready when it’s due'
            }
          />
        )}
        {/* One under the other on a phone */}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
          <FormControlLabel
            control={<Switch checked={reminded} onChange={event => setReminded(event.target.checked)} />}
            label="Remind me"
          />
          {reminded && (
            <TextField
              select
              size="small"
              label="When"
              value={leads}
              onChange={event => setLeads((event.target.value as unknown as number[]).sort((a, b) => a - b))}
              helperText={`Up to ${LIMITS.MAX_LEADS} times`}
              sx={{ flex: 1, minWidth: 0 }}
              slotProps={{
                select: {
                  multiple: true,
                  displayEmpty: true,
                  renderValue: selected => (selected as number[]).map(leadLabel).join(', ') || 'Choose when',
                },
              }}
            >
              {leadChoices(...leads).map(value => (
                <MenuItem
                  key={value}
                  value={value}
                  disabled={!leads.includes(value) && leads.length >= LIMITS.MAX_LEADS}
                >
                  <Checkbox size="small" checked={leads.includes(value)} sx={{ p: 0, mr: 1 }} />
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
