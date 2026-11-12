/**
 * Occurrences as a list: name, amount, what's become of each, and its
 * actions: mark it paid (or received) in one click, or open it for the
 * rest. One whose amount varies asks what it came to instead (its estimate
 * isn't what was paid), and so does one on autopay once it's due. Used by
 * the overview and the calendar's day.
 */

import { useState } from 'react';
import { Box, Button, Chip, IconButton, List, ListItem, Stack, Tooltip, Typography } from '@mui/material';
import { CheckCircleOutlined as PaidIcon, MoreHoriz as MoreIcon } from '@mui/icons-material';
import type { OccurrenceView } from '@budgetmint/contracts';
import { useBudgetChange } from '../../data/BudgetContext';
import { formatDay } from '../../utils/dates';
import { occurrenceLabel } from '../../utils/describe';
import { formatCents, formatMaybeCents } from '../../utils/money';
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
  const [open, setOpen] = useState<{ occurrence: OccurrenceView; askAmount: boolean } | null>(null);

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
              sx={{ gap: 1, py: 0.5, flexWrap: 'wrap', opacity: occurrence.status.state === 'skipped' ? 0.6 : 1 }}
            >
              <Box sx={{ flex: 1, minWidth: 140 }}>
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
              </Box>
              {label && (
                <Chip
                  size="small"
                  label={label}
                  color={CHIP_COLORS[label]}
                  variant={label === 'Autopay' || label === 'Automatic' ? 'outlined' : 'filled'}
                />
              )}
              <Typography
                sx={{
                  fontFamily: MONO,
                  fontWeight: 600,
                  minWidth: 110,
                  textAlign: 'right',
                  color: occurrence.kind === 'income' ? 'success.main' : 'text.primary',
                }}
              >
                {sign}
                {occurrence.status.state === 'done'
                  ? formatCents(occurrence.status.amountCents)
                  : formatMaybeCents(occurrence.expectedCents, occurrence.estimated)}
              </Typography>
              <Stack direction="row" spacing={0.5}>
                {!done && !occurrence.autopay ? (
                  <Button
                    size="small"
                    startIcon={<PaidIcon />}
                    onClick={() =>
                      occurrence.varies ? setOpen({ occurrence, askAmount: true }) : markDone(occurrence)
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
                ) : (
                  <Box sx={{ width: 0 }} />
                )}
                <Tooltip title="Details">
                  <IconButton
                    size="small"
                    aria-label={`${occurrence.name} on ${formatDay(occurrence.scheduled)}: details`}
                    onClick={() => setOpen({ occurrence, askAmount: false })}
                  >
                    <MoreIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </ListItem>
          );
        })}
      </List>
      {open && (
        <OccurrenceDialog
          occurrence={open.occurrence}
          askAmount={open.askAmount}
          today={today}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
