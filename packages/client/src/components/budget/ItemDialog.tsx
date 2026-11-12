/**
 * Adding or editing a bill (or income): what it is, how much, how often
 * (RepeatField), where weekend dates go, when it's first due, and (if it
 * does) when it ends: on a date, or after so many payments. Editing the
 * amount or the schedule asks from when: what's before keeps its
 * occurrences (core's save_item with a change), unless it hasn't started
 * yet. The end is the schedule's last part's: what comes after it doesn't
 * happen. A varying amount is expected at the average of the last few paid;
 * a bill can have money set aside for it a month at a time. Core's refusals
 * are said under the field they're about.
 */

import { useRef, useState } from 'react';
import { Alert, Autocomplete, Checkbox, FormControlLabel, MenuItem, Stack, Switch, TextField } from '@mui/material';
import type { FormField, ItemKind, ItemView, Repeat, Segment, Weekends } from '@budgetmint/contracts';
import { LIMITS } from '@budgetmint/contracts';
import type { CoreRefusal } from '../../core';
import { useBudget, useBudgetChange, useCoreQuery } from '../../data/BudgetContext';
import { useDirty } from '../../hooks/useDirty';
import { categoriesOf } from '../pages/items/ItemFilters';
import { formatWeekdayFrom, parseDay } from '../../utils/dates';
import { ordinal, WEEKS_OF_MONTH, weekdayName } from '../../utils/describe';
import { centsToInput, formatCents, parseDollars } from '../../utils/money';
import { FormDialog } from '../ui/dialogs/FormDialog';
import { CurrencyInput } from '../ui/forms/CurrencyInput';
import { type Every, RepeatField } from './RepeatField';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Repeats on a day of the month: their first date is where they start from, the day is chosen. */
const ON_A_DAY: Every[] = ['months', 'twiceMonthly'];

/** How it ends: it doesn't, on a date, or after so many payments. */
type Ending = 'never' | 'on' | 'after';

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

const NOUNS: Record<ItemKind, string> = { bill: 'bill', income: 'income', transfer: 'transfer' };

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
export function partsOf(repeat: Repeat | undefined, today: string): RepeatParts {
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

/** The form's fields a refusal can be said under. */
type Field =
  | 'name'
  | 'amount'
  | 'repeat'
  | 'dates'
  | 'changeFrom'
  | 'ends'
  | 'category'
  | 'note'
  | 'reminder'
  | 'saved';

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
  const { core } = useBudget();
  const change = useBudgetChange();
  // The categories already in use, offered as it's typed
  const categories = categoriesOf(useCoreQuery('get_items'));
  const item = view?.item;
  // The part of its schedule in force today (core's)
  const segment = view?.current ?? null;
  const [name, setName] = useState(item?.name ?? '');
  const [amount, setAmount] = useState(centsToInput(segment?.amountCents ?? null));
  // A paycheck most often comes every two weeks; a bill, every month
  const fresh: { every: Every; n: number } = goal
    ? { every: 'once', n: 1 }
    : kind === 'income'
      ? { every: 'weeks', n: 2 }
      : { every: 'months', n: 1 };
  const [every, setEvery] = useState<Every>(segment?.repeat.every ?? fresh.every);
  const initial = partsOf(segment?.repeat, today);
  const [n, setN] = useState(String(segment ? initial.n : fresh.n));
  /** "Something else…" is open: every so many days, weeks, months or years. */
  const [custom, setCustom] = useState(false);
  /** The day was chosen: it no longer follows the date it starts on. */
  const [dayChosen, setDayChosen] = useState(false);
  const [from, setFrom] = useState(segment?.from ?? today);
  const [day, setDay] = useState(initial.day);
  const [second, setSecond] = useState(initial.second);
  const [week, setWeek] = useState(initial.week);
  const [weekday, setWeekday] = useState(initial.weekday);
  const [weekends, setWeekends] = useState<Weekends>(segment?.weekends ?? 'keep');
  const [changeFrom, setChangeFrom] = useState(today);
  const lastUntil = item?.schedule.at(-1)?.until ?? null;
  const [ending, setEnding] = useState<Ending>(lastUntil !== null ? 'on' : 'never');
  const [endsOn, setEndsOn] = useState(lastUntil ?? '');
  /** After how many payments it ends, as typed. */
  const [payments, setPayments] = useState('');
  const [category, setCategory] = useState(item?.category ?? '');
  const [autopay, setAutopay] = useState(item?.autopay ?? false);
  const [reminded, setReminded] = useState(item ? item.reminder !== null : kind === 'bill');
  const [leads, setLeads] = useState<number[]>(item?.reminder?.leadDays ?? [defaultLeadDays]);
  const [note, setNote] = useState(item?.note ?? '');
  const [varies, setVaries] = useState(item?.varies ?? false);
  const [saveUp, setSaveUp] = useState(item ? item.saveUp !== null : goal);
  /** What's set aside for it already, as typed: given, setting aside starts over from it today. */
  const [alreadySaved, setAlreadySaved] = useState('');
  // What's set aside so far for the next time it's due (core's goals)
  const soFar = useCoreQuery('get_goals').goals.find(goal => goal.itemId === item?.id)?.setAsideCents;
  const [problem, setProblem] = useState<string | null>(null);
  /** A field left wrong: said under it, and focus goes to it. */
  const [wrong, setWrong] = useState<{ field: Field; message: string } | null>(null);
  const dirty = useDirty([
    name,
    amount,
    every,
    n,
    from,
    day,
    second,
    week,
    weekday,
    weekends,
    changeFrom,
    ending,
    endsOn,
    payments,
    category,
    autopay,
    reminded,
    leads,
    note,
    varies,
    saveUp,
    alreadySaved,
  ]);
  const inputs: Record<Field, React.RefObject<HTMLInputElement | null>> = {
    name: useRef<HTMLInputElement>(null),
    amount: useRef<HTMLInputElement>(null),
    repeat: useRef<HTMLInputElement>(null),
    dates: useRef<HTMLInputElement>(null),
    changeFrom: useRef<HTMLInputElement>(null),
    ends: useRef<HTMLInputElement>(null),
    category: useRef<HTMLInputElement>(null),
    note: useRef<HTMLInputElement>(null),
    reminder: useRef<HTMLInputElement>(null),
    saved: useRef<HTMLInputElement>(null),
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
  // Something saved up for once: what's paid automatically, varies or moves off a weekend isn't for it
  const isGoal = every === 'once' && canSaveUp && saveUp;
  // Started already: a change applies from a date, and what's before stays
  const started = view?.started ?? false;
  const scheduleChanged =
    segment !== null &&
    (cents !== segment.amountCents ||
      !sameRepeat(repeat, segment.repeat) ||
      weekends !== segment.weekends ||
      (!started && from !== segment.from));

  /** The schedule's first `count` dates from `start` (none while what's typed doesn't make one). */
  const datesFrom = (start: string, count: number) => {
    try {
      return core.call('get_schedule_dates', { from: start, repeat, weekends, count });
    } catch {
      return [];
    }
  };
  const firstDue = every !== 'once' && !started && DAY.test(from) ? datesFrom(from, 1)[0] : undefined;
  // After so many payments: from when it starts, or (started already) from the change, or from today
  const counted = Number(payments);
  const countFrom = !started ? from : scheduleChanged ? changeFrom : today;
  const lastPayment =
    ending === 'after' && Number.isInteger(counted) && counted > 0 && DAY.test(countFrom)
      ? datesFrom(countFrom, counted).at(counted - 1)
      : undefined;
  const due = kind === 'bill' ? 'due' : 'comes';

  /** The form's field for core's (a start date, once started, is the change's). */
  const fieldOf = (field: FormField): Field =>
    // (The form names no account yet, so core refuses none: 'account' never comes)
    field === 'dates' && started ? 'changeFrom' : (field as Field);

  const submit = () => {
    if (cents === null) {
      refuse('amount', 'Enter the amount');
      return;
    }
    // Something that happens once has no end
    const ends = every === 'once' ? 'never' : ending;
    if (ends === 'on' && !endsOn) {
      refuse('ends', 'Choose the date it ends on');
      return;
    }
    if (ends === 'after' && !lastPayment) {
      refuse('ends', 'Enter how many payments are left');
      return;
    }
    const until = ends === 'on' ? endsOn : ends === 'after' ? lastPayment!.scheduled : null;
    setWrong(null);
    const base = {
      id: item?.id ?? crypto.randomUUID(),
      kind,
      name,
      category: category || null,
      autopay: autopay && !isGoal,
      // None chosen: no reminder (core's)
      reminder: reminded ? { leadDays: leads } : null,
      archived: item?.archived ?? false,
      note: note || null,
      varies: varies && every !== 'once',
      saveUp: canSaveUp && saveUp,
      // Left empty: what's set aside stays as it is
      savedCents: canSaveUp && saveUp ? (parseDollars(alreadySaved) ?? undefined) : undefined,
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
      // Said under its field, when it's about one
      const field = (error as CoreRefusal).field;
      if (field) refuse(fieldOf(field), (error as Error).message);
      else setProblem((error as Error).message);
      return;
    }
    onClose();
  };

  return (
    <FormDialog
      onClose={onClose}
      dirty={dirty}
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
          inputRef={inputs.name}
          error={wrong?.field === 'name'}
          helperText={wrongAt('name')}
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
        <RepeatField
          every={every}
          n={n}
          custom={custom}
          onChange={(nextEvery, nextN) => {
            setEvery(nextEvery);
            setN(nextN);
          }}
          onCustom={() => setCustom(true)}
          problem={wrongAt('repeat')}
          countRef={inputs.repeat}
        />
        {(every === 'months' || every === 'twiceMonthly') && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label={every === 'months' ? (kind === 'bill' ? 'Due on' : 'Comes on') : 'First on day'}
              value={firstDay}
              onChange={event => {
                setDay(Number(event.target.value));
                setDayChosen(true);
              }}
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
        {/* Something once is on its day: a weekend's isn't moved */}
        {every !== 'days' && every !== 'once' && (
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
            label={every === 'once' ? 'On' : ON_A_DAY.includes(every) ? 'Starting' : 'First on'}
            type="date"
            value={from}
            onChange={event => {
              const date = event.target.value;
              setFrom(date);
              // A new one's day follows the date it starts on, until a day is chosen
              if (!item && !dayChosen && DAY.test(date)) setDay(Number(date.slice(8, 10)));
            }}
            inputRef={inputs.dates}
            error={wrong?.field === 'dates'}
            helperText={wrongAt('dates') ?? (firstDue && `First ${due}: ${formatWeekdayFrom(firstDue.due, today)}`)}
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
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Ends"
              value={ending}
              onChange={event => setEnding(event.target.value as Ending)}
              sx={{ flex: 1 }}
            >
              <MenuItem value="never">Never</MenuItem>
              <MenuItem value="on">On a date</MenuItem>
              <MenuItem value="after">After a number of payments</MenuItem>
            </TextField>
            {ending === 'on' && (
              <TextField
                label="Last on or before"
                type="date"
                value={endsOn}
                onChange={event => setEndsOn(event.target.value)}
                inputRef={inputs.ends}
                error={wrong?.field === 'ends'}
                helperText={wrongAt('ends') ?? 'Nothing after this date'}
                sx={{ flex: 1 }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            )}
            {ending === 'after' && (
              <TextField
                label={started ? 'How many more' : 'How many'}
                type="number"
                value={payments}
                onChange={event => {
                  setPayments(event.target.value);
                  // What it said was missing is being given
                  setWrong(null);
                }}
                inputRef={inputs.ends}
                error={wrong?.field === 'ends'}
                helperText={
                  wrongAt('ends') ??
                  (lastPayment
                    ? `The last on ${formatWeekdayFrom(lastPayment.due, today)}`
                    : 'Payments, counting the next')
                }
                sx={{ flex: 1 }}
                slotProps={{ htmlInput: { min: 1 } }}
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
              inputRef={inputs.category}
              error={wrong?.field === 'category'}
              helperText={wrongAt('category')}
              label="Category (optional)"
              slotProps={{
                ...params.slotProps,
                htmlInput: { ...params.slotProps.htmlInput, maxLength: LIMITS.MAX_CATEGORY },
              }}
            />
          )}
        />
        {!isGoal && (
          <FormControlLabel
            control={<Switch checked={autopay} onChange={event => setAutopay(event.target.checked)} />}
            label={kind === 'bill' ? 'Paid automatically (autopay)' : 'Comes in automatically'}
          />
        )}
        {/* Once, it's what it is: nothing to average */}
        {every !== 'once' && (
          <FormControlLabel
            control={<Switch checked={varies} onChange={event => setVaries(event.target.checked)} />}
            label={`The amount varies: expect the average of the last ${LIMITS.ESTIMATE_FROM} ${kind === 'bill' ? 'paid' : 'received'}`}
          />
        )}
        {canSaveUp && (
          <FormControlLabel
            control={<Switch checked={saveUp} onChange={event => setSaveUp(event.target.checked)} />}
            label={
              every === 'once'
                ? 'Set money aside for it each month until then'
                : 'Set money aside for it each month, so it’s ready when it’s due'
            }
          />
        )}
        {canSaveUp && saveUp && (
          <CurrencyInput
            label="Already set aside (optional)"
            value={alreadySaved}
            onChange={setAlreadySaved}
            inputRef={inputs.saved}
            error={wrong?.field === 'saved'}
            helperText={
              wrongAt('saved') ??
              (soFar === undefined
                ? 'What you’ve set aside for it already: the rest is spread over the months left'
                : `${formatCents(soFar)} set aside so far. Say what's set aside now to go on from that.`)
            }
          />
        )}
        {item?.saveUp && !saveUp && (
          <Alert severity="warning">
            What's set aside for it so far is let go. Turned on again, it starts over from today.
          </Alert>
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
              inputRef={inputs.reminder}
              error={wrong?.field === 'reminder'}
              helperText={wrongAt('reminder') ?? `Up to ${LIMITS.MAX_LEADS} times`}
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
          inputRef={inputs.note}
          error={wrong?.field === 'note'}
          helperText={wrongAt('note')}
          multiline
          minRows={2}
          slotProps={{ htmlInput: { maxLength: LIMITS.MAX_NOTE } }}
        />
      </Stack>
    </FormDialog>
  );
}
