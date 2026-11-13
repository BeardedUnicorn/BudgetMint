/**
 * The bank accounts side by side: each one's balance today, what's safe to
 * spend from it, and whether it goes low or below zero ahead. One without a
 * balance, or with one too old to go by, says it's left out of the total.
 */

import { Box, Paper, Typography } from '@mui/material';
import type { AccountCard } from '@budgetmint/contracts';
import { PHONE } from '../../../theme/media';
import { formatDay, formatWeekday } from '../../../utils/dates';
import { formatCents } from '../../../utils/money';
import { BalanceFlag } from '../../budget/BalanceFlag';

const MONO = '"Roboto Mono", monospace';

/** Why an account isn't in the total. */
const leftOut = (card: AccountCard) =>
  card.balance
    ? `Its balance is from ${formatDay(card.balance.asOf)}: too old to count in the total. Update it.`
    : 'No balance yet: not in the total.';

export function AccountCards({ accounts }: { accounts: AccountCard[] }) {
  return (
    <Box
      component="section"
      aria-label="Your accounts"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 2,
        mb: 3,
        [PHONE]: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
      }}
    >
      {accounts.map(card => {
        const flagged = card.firstShort ?? card.firstLow;
        return (
          <Paper key={card.id} role="group" aria-label={card.name} sx={{ p: 2, minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary" sx={{ overflowWrap: 'anywhere', lineHeight: 1.4 }}>
              {card.name}
            </Typography>
            <Typography
              sx={{ fontFamily: MONO, fontWeight: 700, color: card.todayCents < 0 ? 'error.main' : 'text.primary' }}
            >
              {formatCents(card.todayCents)}
            </Typography>
            {card.counted ? (
              <Typography variant="caption" color="text.secondary" component="p">
                Safe to spend {formatCents(card.safeToSpendCents)}
              </Typography>
            ) : (
              <Typography variant="caption" color="warning.main" component="p">
                {leftOut(card)}
              </Typography>
            )}
            {flagged && (
              <Typography variant="caption" component="p" color={card.firstShort ? 'error.main' : 'warning.main'}>
                <BalanceFlag short={card.firstShort !== null} low hidden />
                {card.firstShort ? 'Below zero' : 'Low'} {formatWeekday(flagged.date)}
              </Typography>
            )}
          </Paper>
        );
      })}
    </Box>
  );
}
