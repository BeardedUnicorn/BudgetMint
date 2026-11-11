/**
 * A calendar day: everything due, TaskMint's money coming in, and the
 * balance at its end; the previous and next days a click away.
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
import { formatLongDay } from '../../../utils/dates';
import { formatCents, formatMaybeCents } from '../../../utils/money';
import { OccurrenceList } from '../../budget/OccurrenceList';

const MONO = '"Roboto Mono", monospace';

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
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      sx={{ '& .MuiDialog-container': { alignItems: 'flex-start' } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton aria-label="The day before" onClick={() => onStep(-1)}>
          <ChevronLeft />
        </IconButton>
        <Box sx={{ flex: 1 }}>{formatLongDay(day.date)}</Box>
        <IconButton aria-label="The day after" onClick={() => onStep(1)}>
          <ChevronRight />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {day.occurrences.length > 0 && <OccurrenceList occurrences={day.occurrences} today={today} />}
        {day.occurrences.length === 0 && day.withdrawalCents === 0 && (
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
        {day.closingCents !== null && (
          <Typography
            variant="body2"
            sx={{ mt: 2, fontFamily: MONO, color: day.short ? 'error.main' : 'text.secondary' }}
          >
            Balance at the end of the day: {formatCents(day.closingCents)}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
