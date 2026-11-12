/**
 * A calendar day: everything due, TaskMint's money coming in, what the day's
 * work earned in TaskMint that's not withdrawn yet (and when it reaches the
 * bank), the everyday spending taken out, and the balance at its end; the
 * previous and next days a click away.
 */

import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { ChevronLeft, ChevronRight } from '@mui/icons-material';
import type { CalendarDay } from '@budgetmint/contracts';
import { useBackDismiss } from '../../../contexts/NavigationContext';
import { formatLongDay } from '../../../utils/dates';
import { formatCents, formatMaybeCents } from '../../../utils/money';
import { BalanceFlag } from '../../budget/BalanceFlag';
import { OccurrenceList } from '../../budget/OccurrenceList';

const MONO = '"Roboto Mono", monospace';

/** A day's details: what's due, TaskMint's money, the everyday spending, and the balance it ends on. */
export function DayAgenda({ day, today }: { day: CalendarDay; today: string }) {
  return (
    <>
      {day.occurrences.length > 0 && <OccurrenceList occurrences={day.occurrences} today={today} />}
      {day.occurrences.length === 0 && day.withdrawalCents === 0 && day.earnedCents === 0 && (
        <Typography variant="body2" color="text.secondary">
          Nothing due.
        </Typography>
      )}
      {day.withdrawalCents > 0 && (
        <Stack direction="row" sx={{ py: 1, justifyContent: 'space-between' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {day.withdrawalProjected ? 'TaskMint withdrawal (expected)' : 'TaskMint withdrawal'}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontWeight: 600, color: 'secondary.main' }}>
            +{formatMaybeCents(day.withdrawalCents, day.withdrawalUncertainCents > 0)}
          </Typography>
        </Stack>
      )}
      {day.earnedCents > 0 && (
        <Box sx={{ py: 1 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Earned in TaskMint, not withdrawn yet
            </Typography>
            <Typography sx={{ fontFamily: MONO, fontWeight: 600, color: 'secondary.main' }}>
              {formatMaybeCents(day.earnedCents, day.earnedUncertainCents > 0)}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {day.earnedArrivesOn
              ? `In the bank ${formatLongDay(day.earnedArrivesOn)}, with the withdrawal that takes it.`
              : 'No withdrawal ahead takes it yet.'}
          </Typography>
        </Box>
      )}
      {day.spendingCents > 0 && (
        <Stack direction="row" sx={{ py: 1, justifyContent: 'space-between' }}>
          <Typography variant="body2" color="text.secondary">
            Everyday spending (assumed)
          </Typography>
          <Typography sx={{ fontFamily: MONO, color: 'text.secondary' }}>−{formatCents(day.spendingCents)}</Typography>
        </Stack>
      )}
      {day.closingCents !== null && (
        <Typography
          variant="body2"
          sx={{
            mt: 2,
            fontFamily: MONO,
            color: day.short ? 'error.main' : day.low ? 'warning.main' : 'text.secondary',
          }}
        >
          {/* Below zero or low: said with a mark, not only a colour */}
          <BalanceFlag short={day.short} low={day.low} />
          Balance at the end of the day: {formatCents(day.closingCents)}
        </Typography>
      )}
    </>
  );
}

export function DayDialog({
  day,
  today,
  onStep,
  onClose,
}: {
  day: CalendarDay;
  today: string;
  /** To the day before (-1) or after (1). */
  onStep: (days: number) => void;
  onClose: () => void;
}) {
  useBackDismiss(true, onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      sx={{ '& .MuiDialog-container': { alignItems: 'flex-start' } }}
    >
      {/* The title is the day alone (it names the dialog); the buttons sit beside it, not in it */}
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2 }}>
        <IconButton aria-label="The day before" onClick={() => onStep(-1)}>
          <ChevronLeft />
        </IconButton>
        <DialogTitle sx={{ flex: 1, px: 1 }}>{formatLongDay(day.date)}</DialogTitle>
        <IconButton aria-label="The day after" onClick={() => onStep(1)}>
          <ChevronRight />
        </IconButton>
      </Box>
      <DialogContent>
        <DayAgenda day={day} today={today} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
