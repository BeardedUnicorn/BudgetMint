/**
 * How often a bill or income comes round, as people say it: every week,
 * every 2 weeks, every month, and the like. "Something else…" opens core's
 * whole range (every so many days, weeks, months or years, a weekday of the
 * month). Each choice is one of core's repeats, so nothing new is stored.
 */

import { MenuItem, Stack, TextField } from '@mui/material';
import type { Repeat } from '@budgetmint/contracts';

export type Every = Repeat['every'];

/** The everyday choices, in the menu's order: each a repeat, every `n`. */
export const PRESETS = [
  { id: 'once', label: 'Once', every: 'once', n: 1 },
  { id: 'weekly', label: 'Every week', every: 'weeks', n: 1 },
  { id: 'biweekly', label: 'Every 2 weeks', every: 'weeks', n: 2 },
  { id: 'twiceMonthly', label: 'Twice a month', every: 'twiceMonthly', n: 1 },
  { id: 'monthly', label: 'Every month', every: 'months', n: 1 },
  { id: 'quarterly', label: 'Every 3 months', every: 'months', n: 3 },
  { id: 'halfYearly', label: 'Every 6 months', every: 'months', n: 6 },
  { id: 'yearly', label: 'Every year', every: 'years', n: 1 },
] as const satisfies readonly { id: string; label: string; every: Every; n: number }[];

const CUSTOM = 'custom';

/** The everyday choice a repeat is (once and twice a month whatever `n`), or none. */
export function presetOf(every: Every, n: number): string | null {
  const found = PRESETS.find(
    preset => preset.every === every && (every === 'once' || every === 'twiceMonthly' || preset.n === n)
  );
  return found?.id ?? null;
}

/** How each repeat reads among "Something else…"'s, in its order there. */
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
export const EVERY_UNITS: Partial<Record<Every, string>> = {
  days: 'days',
  weeks: 'weeks',
  months: 'months',
  monthWeekday: 'months',
  years: 'years',
};

export function RepeatField({
  every,
  n,
  custom,
  onChange,
  onCustom,
  problem,
  countRef,
}: {
  every: Every;
  /** "Every how many", as typed. */
  n: string;
  /** "Something else…" is open. */
  custom: boolean;
  onChange: (every: Every, n: string) => void;
  onCustom: () => void;
  /** Core's refusal of how often, said under it. */
  problem?: string;
  countRef?: React.Ref<HTMLInputElement>;
}) {
  const preset = custom ? null : presetOf(every, Number(n));
  // A repeat no everyday choice is opens the whole range too
  const open = preset === null;
  return (
    <>
      <TextField
        select
        label="Repeats"
        value={preset ?? CUSTOM}
        onChange={event => {
          const chosen = PRESETS.find(choice => choice.id === event.target.value);
          if (chosen) onChange(chosen.every, String(chosen.n));
          else onCustom();
        }}
        error={Boolean(problem) && !open}
        helperText={open ? undefined : problem}
      >
        {PRESETS.map(choice => (
          <MenuItem key={choice.id} value={choice.id}>
            {choice.label}
          </MenuItem>
        ))}
        <MenuItem value={CUSTOM}>Something else…</MenuItem>
      </TextField>
      {/* One under the other on a phone, where "Every how many months" doesn't fit beside it */}
      {open && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label="Every"
            value={every}
            onChange={event => onChange(event.target.value as Every, n)}
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
              onChange={event => onChange(every, event.target.value)}
              inputRef={countRef}
              error={Boolean(problem)}
              helperText={problem}
              sx={{ flex: 1 }}
              slotProps={{ htmlInput: { min: 1 } }}
            />
          )}
        </Stack>
      )}
    </>
  );
}
