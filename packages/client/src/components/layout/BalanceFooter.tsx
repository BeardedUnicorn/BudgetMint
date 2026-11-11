/**
 * The sidebar's foot: today's balance and the lowest it gets ahead (TaskMint
 * keeps today's goal here), and whether changes are still on their way.
 */

import { Box, Chip, Tooltip, Typography } from '@mui/material';
import { useBudget, useCoreQuery } from '../../data/BudgetContext';
import { formatWeekday } from '../../utils/dates';
import { formatCents, formatWholeCents } from '../../utils/money';

const MONO = '"Roboto Mono", monospace';

export function BalanceFooter({ collapsed }: { collapsed: boolean }) {
  const { view } = useBudget();
  const { todayCents, lowest } = useCoreQuery('get_overview');
  const status = view.offline ? 'Offline' : view.saving ? 'Saving…' : null;
  const label = `Balance today ${formatCents(todayCents)}; lowest ahead ${formatCents(lowest.cents)} on ${formatWeekday(lowest.date)}`;

  if (collapsed) {
    return (
      <Tooltip title={label} placement="right">
        <Typography
          role="img"
          aria-label={label}
          // In the tab order, so the keyboard reaches its tooltip too
          tabIndex={0}
          sx={{
            // A large balance wraps within the narrow sidebar
            overflowWrap: 'anywhere',
            textAlign: 'center',
            fontFamily: MONO,
            fontWeight: 700,
            fontSize: '0.75rem',
            color: todayCents < 0 ? 'error.main' : 'text.primary',
          }}
        >
          {formatWholeCents(todayCents)}
        </Typography>
      </Tooltip>
    );
  }
  return (
    <Box role="group" aria-label={label}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          Today
        </Typography>
        {status && <Chip size="small" label={status} variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />}
      </Box>
      <Typography sx={{ fontFamily: MONO, fontWeight: 700, color: todayCents < 0 ? 'error.main' : 'text.primary' }}>
        {formatCents(todayCents)}
      </Typography>
      <Typography variant="caption" color={lowest.cents < 0 ? 'error.main' : 'text.secondary'}>
        Lowest {formatCents(lowest.cents)}, {formatWeekday(lowest.date)}
      </Typography>
    </Box>
  );
}
