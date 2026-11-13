/**
 * Money paid (or received, or moved) on or before a balance's day: whether
 * it moves the balance too. The forecast starts from the balance, so it
 * leaves out what's dated by then, taking the balance to count it already.
 * That's right for what came before the balance's day; on the day itself
 * it may have gone after the balance was set, so there it's taken off (or
 * added) unless the user unticks it: a wrong tick only shows less money
 * than there is, a wrong untick shows money that's gone. Core's
 * from_balance moves it, in the same change. The balance is the one of the
 * account the money is in, named when there's more than one account; money
 * moved between two accounts moves each one's balance that's dated by then.
 */

import { useState } from 'react';
import { Box, Checkbox, FormControlLabel, Typography } from '@mui/material';
import type { Balance, ItemKind } from '@budgetmint/contracts';
import { MAIN_ACCOUNT } from '@budgetmint/contracts';
import { accountBalance, useAccounts } from '../../data/BudgetContext';
import { formatDay } from '../../utils/dates';
import { KIND_WORDS } from '../../utils/kinds';
import { formatCents } from '../../utils/money';

/** A whole day, as a date field holds it (empty while it's being typed). */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** An account whose balance the money moves. */
interface Side {
  name: string;
  balance: Balance;
  /** Out of it below zero, into it above. */
  sign: 1 | -1;
}

export interface FromBalance {
  /** Paid on `on`, it's by a balance's day: the choice shows. */
  applies: boolean;
  /** Take it off (or add it): what's sent as fromBalance. */
  checked: boolean;
  /** The user's own choice, over the default. */
  choose: (checked: boolean) => void;
  /** The balances it would move (none: no balance is dated by then, so it never applies). */
  sides: Side[];
  /** Whose balance, in words: "your", or "the Savings" (the account's name) when there are several. */
  whose: string;
  /** The same, to start a sentence with. */
  Whose: string;
}

/**
 * The choice for money paid on `on` (a day, or null while it isn't paid).
 * On autopay it went by itself on its day, so the balance is taken to have
 * it unless the user says otherwise. The balance is `accountId`'s, and for
 * a transfer `toAccountId`'s too.
 */
export function useFromBalance(
  on: string | null,
  {
    kind,
    autopay = false,
    accountId = MAIN_ACCOUNT,
    toAccountId = null,
  }: { kind: ItemKind; autopay?: boolean; accountId?: string; toAccountId?: string | null }
): FromBalance {
  const { all, several, nameOf } = useAccounts();
  const [chosen, setChosen] = useState<boolean | null>(null);
  const day = on !== null && DAY.test(on) ? on : null;
  // Out of its own account, unless it's income; and into where a transfer goes
  const touched: [string, 1 | -1][] = [
    [accountId, kind === 'income' ? 1 : -1],
    ...(kind === 'transfer' && toAccountId ? [[toAccountId, 1] as [string, 1]] : []),
  ];
  const sides = touched.flatMap(([id, sign]) => {
    const balance = accountBalance(all, id);
    return balance && day !== null && day <= balance.asOf ? [{ name: nameOf(id), balance, sign }] : [];
  });
  const applies = sides.length > 0;
  return {
    applies,
    // On a balance's own day it may have gone after: moved unless unticked
    checked: applies && (chosen ?? (sides.some(side => side.balance.asOf === day) && !autopay)),
    choose: setChosen,
    sides,
    whose: several ? `the ${nameOf(accountId)}` : 'your',
    Whose: several ? `The ${nameOf(accountId)}` : 'Your',
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
  if (!state.applies) return null;
  const moved = ({ balance, sign }: Side) =>
    `${formatCents(balance.cents)}${amountCents === null ? '' : ` → ${formatCents(balance.cents + sign * amountCents)}`}`;
  const check = <Checkbox checked={state.checked} onChange={event => state.choose(event.target.checked)} />;
  if (kind === 'transfer') {
    return (
      <Box>
        <FormControlLabel
          control={check}
          label={`Move ${state.sides.length > 1 ? 'the balances' : 'the balance'} too: ${state.sides.map(side => `${side.name} ${moved(side)}`).join(', ')}`}
        />
        <Typography variant="caption" color="text.secondary" component="p">
          A balance from that day or after may count it already: untick this if it does.
        </Typography>
      </Box>
    );
  }
  // One account's: it applies only with its balance
  const [side] = state.sides;
  const { asOf } = side.balance;
  return (
    <Box>
      <FormControlLabel
        control={check}
        label={`${kind === 'bill' ? 'Take it off' : 'Add it to'} ${state.whose} balance: ${moved(side)}`}
      />
      <Typography variant="caption" color="text.secondary" component="p">
        {on === asOf
          ? `${state.Whose} balance is from the same day, ${formatDay(asOf)}. Untick this if it counts it already.`
          : `It’s before ${state.whose} balance’s day, ${formatDay(asOf)}: the balance likely counts it already.`}
      </Typography>
    </Box>
  );
}

/** The toast after saving: says when the balance moved too. */
export function savedSaying(done: string, kind: ItemKind, fromBalance: boolean): string {
  if (!fromBalance) return done;
  return `${done}, and ${KIND_WORDS[kind].balanceSaid}`;
}
