/**
 * Occurrences as a list: name, amount, what's become of each, and its
 * actions: mark it paid (or received) in one click, or open it for the
 * rest. One whose amount varies asks what it came to instead (its estimate
 * isn't what was paid), and so does one on autopay once it's due; on the
 * balance's own day, Mark paid opens it too, to ask whether the balance
 * has it already (FromBalance). With more than one bank account, each says
 * which it's in. Used by the overview and the calendar's day.
 */

import { useState } from 'react';
import { Box, Button, Chip, IconButton, List, ListItem, Tooltip, Typography } from '@mui/material';
import { CheckCircleOutlined as PaidIcon, MoreHoriz as MoreIcon } from '@mui/icons-material';
import type { OccurrenceView } from '@budgetmint/contracts';
import { accountBalance, useAccounts, useBudgetChange } from '../../data/BudgetContext';
import { formatDay } from '../../utils/dates';
import { occurrenceLabel } from '../../utils/describe';
import { formatCents, formatMaybeCents } from '../../utils/money';
import { PHONE } from '../../theme/media';
import { useNotification } from '../../contexts/NotificationContext';
import { OccurrenceDialog } from './OccurrenceDialog';

const MONO = '"Roboto Mono", monospace';

const CHIP_COLORS: Record<string, 'success' | 'warning' | 'error' | 'default' | 'info'> = {
  Paid: 'success',
  Received: 'success',
  Skipped: 'default',
  Overdue: 'error',
  Late: 'warning',
  Autopay: 'info',
  Automatic: 'info',
};

export function OccurrenceList({ occurrences, today }: { occurrences: OccurrenceView[]; today: string }) {
  const change = useBudgetChange();
  const { showError } = useNotification();
  const [open, setOpen] = useState<{ occurrence: OccurrenceView; askAmount?: boolean; paying?: boolean } | null>(null);
  const { all, several, nameOf } = useAccounts();
  // Its account's balance set today may or may not have what's paid now: Mark paid asks
  const balanceToday = (occurrence: OccurrenceView) => accountBalance(all, occurrence.accountId)?.asOf === today;

  const markDone = (occurrence: OccurrenceView) => {
    try {
      change(
        'set_occurrence',
        {
          occurrence: {
            itemId: occurrence.itemId,
            date: occurrence.scheduled,
            status: { state: 'done', on: today, amountCents: occurrence.expectedCents },
            // Only its status changes: where it was moved and this time's amount stay
            amountCents: occurrence.amountCents,
            movedTo: occurrence.due === occurrence.scheduled ? null : occurrence.due,
            note: occurrence.note,
          },
        },
        `${occurrence.name} marked ${occurrence.kind === 'bill' ? 'paid' : 'received'}`
      );
    } catch (error) {
      showError((error as Error).message);
    }
  };

  return (
    <>
      <List disablePadding>
        {occurrences.map(occurrence => {
          const label = occurrenceLabel(occurrence);
          const done = occurrence.status.state !== 'open';
          const sign = occurrence.kind === 'bill' ? '−' : '+';
          const verb = occurrence.kind === 'bill' ? 'paid' : 'received';
          return (
            <ListItem
              key={`${occurrence.itemId} ${occurrence.scheduled}`}
              disableGutters
              sx={{
                // Name, amount, Mark paid, details; on a phone Mark paid goes under, so amounts line up
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto',
                alignItems: 'center',
                columnGap: 1,
                py: 0.5,
                opacity: occurrence.status.state === 'skipped' ? 0.6 : 1,
                [PHONE]: {
                  gridTemplateColumns: '1fr auto auto',
                  gridTemplateAreas: '"name amount details" "action action action"',
                },
              }}
            >
              <Box sx={{ minWidth: 0, [PHONE]: { gridArea: 'name' } }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {occurrence.name}
                </Typography>
                {(occurrence.due !== occurrence.scheduled || occurrence.note) && (
                  <Typography variant="caption" color="text.secondary">
                    {occurrence.due !== occurrence.scheduled ? `Moved from ${formatDay(occurrence.scheduled)}` : ''}
                    {occurrence.due !== occurrence.scheduled && occurrence.note ? ' · ' : ''}
                    {occurrence.note}
                  </Typography>
                )}
                {several && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {nameOf(occurrence.accountId)}
                  </Typography>
                )}
                {/* Its amount doesn't move the day's balance: say why */}
                {occurrence.inBalance && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    In your balance already
                  </Typography>
                )}
                {/* Under the name, so it never pushes the amount out of line */}
                {label && (
                  <Box>
                    <Chip
                      size="small"
                      label={label}
                      color={CHIP_COLORS[label]}
                      variant={label === 'Autopay' || label === 'Automatic' ? 'outlined' : 'filled'}
                      sx={{ mt: 0.25 }}
                    />
                  </Box>
                )}
              </Box>
              <Typography
                sx={{
                  fontFamily: MONO,
                  fontWeight: 600,
                  minWidth: 110,
                  textAlign: 'right',
                  [PHONE]: { gridArea: 'amount', minWidth: 0 },
                  color: occurrence.kind === 'income' ? 'success.main' : 'text.primary',
                }}
              >
                {sign}
                {occurrence.status.state === 'done'
                  ? formatCents(occurrence.status.amountCents)
                  : formatMaybeCents(occurrence.expectedCents, occurrence.estimated)}
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', [PHONE]: { gridArea: 'action' } }}>
                {!done && !occurrence.autopay ? (
                  <Button
                    size="small"
                    startIcon={<PaidIcon />}
                    onClick={() =>
                      occurrence.varies
                        ? setOpen({ occurrence, askAmount: true })
                        : balanceToday(occurrence)
                          ? setOpen({ occurrence, paying: true })
                          : markDone(occurrence)
                    }
                    aria-label={`Mark ${occurrence.name} ${verb}`}
                  >
                    {occurrence.kind === 'bill' ? 'Mark paid' : 'Mark received'}
                  </Button>
                ) : !done && occurrence.varies && occurrence.due <= today ? (
                  // On autopay, so it's gone: what it came to teaches its estimate
                  <Button
                    size="small"
                    startIcon={<PaidIcon />}
                    onClick={() => setOpen({ occurrence, askAmount: true })}
                    aria-label={`Enter what ${occurrence.name} came to on ${formatDay(occurrence.due)}`}
                  >
                    Enter amount
                  </Button>
                ) : null}
              </Box>
              <Tooltip title="Details">
                <IconButton
                  size="small"
                  aria-label={`${occurrence.name} on ${formatDay(occurrence.scheduled)}: details`}
                  onClick={() => setOpen({ occurrence })}
                  sx={{ [PHONE]: { gridArea: 'details' } }}
                >
                  <MoreIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </ListItem>
          );
        })}
      </List>
      {open && (
        <OccurrenceDialog
          occurrence={open.occurrence}
          askAmount={open.askAmount}
          paying={open.paying}
          today={today}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
