/**
 * Money paid (or received) on or before the balance's day: whether it moves
 * the balance too. The forecast starts from the balance, so it leaves out
 * what's dated by then, taking the balance to count it already. That's
 * right for what came before the balance's day; on the day itself it may
 * have gone after the balance was set, so there it's taken off (or added)
 * unless the user unticks it: a wrong tick only shows less money than
 * there is, a wrong untick shows money that's gone. Core's from_balance
 * moves it, in the same change.
 */

import { useState } from 'react';
import { Box, Checkbox, FormControlLabel, Typography } from '@mui/material';
import type { ItemKind } from '@budgetmint/contracts';
import { useCoreQuery } from '../../data/BudgetContext';
import { formatDay } from '../../utils/dates';
import { formatCents } from '../../utils/money';

/** A whole day, as a date field holds it (empty while it's being typed). */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface FromBalance {
  /** Paid on `on`, it's by the balance's day: the choice shows. */
  applies: boolean;
  /** Take it off (or add it): what's sent as fromBalance. */
  checked: boolean;
  /** The user's own choice, over the default. */
  choose: (checked: boolean) => void;
  /** The balance's day and amount (null: none set). */
  asOf: string | null;
  cents: number;
}

/** The choice for money paid on `on` (a day, or null while it isn't paid). */
export function useFromBalance(on: string | null): FromBalance {
  const { settings } = useCoreQuery('get_settings');
  const balance = settings.balance;
  const [chosen, setChosen] = useState<boolean | null>(null);
  const applies = balance !== null && on !== null && DAY.test(on) && on <= balance.asOf;
  return {
    applies,
    // On the balance's own day it may have gone after: moved unless unticked
    checked: applies && (chosen ?? on === balance.asOf),
    choose: setChosen,
    asOf: balance?.asOf ?? null,
    cents: balance?.cents ?? 0,
  };
}

/** The checkbox, and what it does to the balance: nothing while it doesn't apply. */
export function FromBalanceField({
  kind,
  amountCents,
  on,
  state,
}: {
  kind: ItemKind;
  /** What was paid, once it's a number. */
  amountCents: number | null;
  on: string;
  state: FromBalance;
}) {
  if (!state.applies || state.asOf === null) return null;
  const bill = kind === 'bill';
  const moved = amountCents === null ? null : state.cents + (bill ? -amountCents : amountCents);
  return (
    <Box>
      <FormControlLabel
        control={<Checkbox checked={state.checked} onChange={event => state.choose(event.target.checked)} />}
        label={`${bill ? 'Take it off your balance' : 'Add it to your balance'}: ${formatCents(state.cents)}${moved === null ? '' : ` → ${formatCents(moved)}`}`}
      />
      <Typography variant="caption" color="text.secondary" component="p">
        {on === state.asOf
          ? `Your balance is from the same day, ${formatDay(state.asOf)}. Untick this if it counts it already.`
          : `It’s before your balance’s day, ${formatDay(state.asOf)}: the balance likely counts it already.`}
      </Typography>
    </Box>
  );
}

/** The toast after saving: says when the balance moved too. */
export function savedSaying(done: string, kind: ItemKind, fromBalance: boolean): string {
  if (!fromBalance) return done;
  return `${done}, and ${kind === 'bill' ? 'taken off' : 'added to'} your balance`;
}
