/**
 * The sidebar's foot: today's balance and the lowest it gets ahead (TaskMint
 * keeps today's goal here), and whether changes are still on their way.
 * With more than one bank account it's all of them together, and a tap
 * lists each.
 */

import { useState } from 'react';
import { Box, Button, Chip, List, ListItem, ListItemText, Popover, Tooltip, Typography } from '@mui/material';
import { useBudget, useCoreQuery } from '../../data/BudgetContext';
import { formatWeekday } from '../../utils/dates';
import { formatCents, formatWholeCents } from '../../utils/money';

const MONO = '"Roboto Mono", monospace';

export function BalanceFooter({ collapsed }: { collapsed: boolean }) {
  const { view } = useBudget();
  // Every account together, whichever the Overview is showing
  const { todayCents, lowest, accounts } = useCoreQuery('get_overview');
  const several = accounts.length > 1;
  /** The list of accounts, while it's open. */
  const [listing, setListing] = useState<HTMLElement | null>(null);
  const status = view.offline ? 'Offline' : view.saving ? 'Saving…' : null;
  const label = `Balance today${several ? ', all accounts' : ''} ${formatCents(todayCents)}; lowest ahead ${formatCents(lowest.cents)} on ${formatWeekday(lowest.date)}`;

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
          {several ? 'Today, all accounts' : 'Today'}
        </Typography>
        {status && <Chip size="small" label={status} variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />}
      </Box>
      <Typography sx={{ fontFamily: MONO, fontWeight: 700, color: todayCents < 0 ? 'error.main' : 'text.primary' }}>
        {formatCents(todayCents)}
      </Typography>
      <Typography variant="caption" color={lowest.cents < 0 ? 'error.main' : 'text.secondary'}>
        Lowest {formatCents(lowest.cents)}, {formatWeekday(lowest.date)}
      </Typography>
      {several && (
        <>
          <Button
            size="small"
            onClick={event => setListing(event.currentTarget)}
            aria-haspopup="dialog"
            sx={{ display: 'block', px: 0, minWidth: 0 }}
          >
            {accounts.length} accounts
          </Button>
          <Popover
            open={listing !== null}
            anchorEl={listing}
            onClose={() => setListing(null)}
            anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
            transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          >
            <List dense aria-label="Each account today">
              {accounts.map(account => (
                <ListItem key={account.id}>
                  <ListItemText
                    primary={account.name}
                    secondary={account.counted ? formatCents(account.todayCents) : 'Not in the total'}
                  />
                </ListItem>
              ))}
            </List>
          </Popover>
        </>
      )}
    </Box>
  );
}
