/**
 * Calendar: a month of bills, income and TaskMint's withdrawals, with each
 * day's closing balance; the month's totals above, a day's details a click
 * away.
 */

import { useId, useState } from 'react';
import { Box, Button, IconButton, Paper, Typography } from '@mui/material';
import { ChevronLeft, ChevronRight } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { useCoreQuery } from '../../../data/BudgetContext';
import { PHONE } from '../../../theme/media';
import { addDays, addMonths, formatMonth } from '../../../utils/dates';
import { formatCents } from '../../../utils/money';
import { PageContainer, PageHeader } from '../../layout/PageLayout';
import { DayDialog } from './DayDialog';
import { MonthGrid } from './MonthGrid';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography sx={{ fontFamily: '"Roboto Mono", monospace', fontWeight: 600 }}>{value}</Typography>
    </Box>
  );
}

function LegendItem({
  tone,
  dashed = false,
  children,
}: {
  tone: 'error' | 'success' | 'secondary';
  dashed?: boolean;
  children: string;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <Box
        sx={theme => ({
          width: 14,
          height: 10,
          borderRadius: 0.5,
          border: `1px ${dashed ? 'dashed' : 'solid'} ${theme.palette[tone].main}`,
          bgcolor: dashed ? 'transparent' : alpha(theme.palette[tone].main, 0.3),
        })}
      />
      <Typography variant="caption" color="text.secondary">
        {children}
      </Typography>
    </Box>
  );
}

export function CalendarPage() {
  const { today } = useCoreQuery('get_overview');
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [focusedDate, setFocusedDate] = useState(today);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const view = useCoreQuery('get_month', { month });
  const titleId = useId();
  const open = view.days.find(day => day.date === openDay);

  const goToMonth = (next: string) => {
    setMonth(next);
    setFocusedDate(next === thisMonth ? today : `${next}-01`);
  };
  const step = (days: number) => {
    const next = addDays(openDay!, days);
    if (next.slice(0, 7) !== month) setMonth(next.slice(0, 7));
    setOpenDay(next);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Calendar"
        subtitle="Bills, income and TaskMint’s withdrawals, with the balance each day ends on."
      />
      <Paper sx={{ p: { xs: 1.5, sm: 2.5 } }}>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            mb: 2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, [PHONE]: { width: '100%' } }}>
            <IconButton aria-label="Previous month" onClick={() => goToMonth(addMonths(month, -1))}>
              <ChevronLeft />
            </IconButton>
            <Typography
              id={titleId}
              variant="h5"
              component="h2"
              aria-live="polite"
              sx={{
                fontWeight: 700,
                minWidth: 190,
                textAlign: 'center',
                [PHONE]: { minWidth: 0, flex: 1, fontSize: '1.1rem' },
              }}
            >
              {formatMonth(month)}
            </Typography>
            <IconButton aria-label="Next month" onClick={() => goToMonth(addMonths(month, 1))}>
              <ChevronRight />
            </IconButton>
            <Button
              size="small"
              variant="outlined"
              disabled={month === thisMonth}
              onClick={() => goToMonth(thisMonth)}
              sx={{ ml: 1 }}
            >
              Today
            </Button>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: { xs: 2, sm: 3 } }}>
            <Stat label="Bills" value={formatCents(view.billsCents)} />
            <Stat label="Income" value={formatCents(view.incomeCents)} />
            <Stat label="TaskMint" value={formatCents(view.withdrawalsCents)} />
          </Box>
        </Box>

        <MonthGrid
          view={view}
          focusedDate={focusedDate}
          onFocusDate={setFocusedDate}
          onMonthChange={setMonth}
          onOpenDay={setOpenDay}
          labelledBy={titleId}
        />

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 2 }}>
          <LegendItem tone="error">Bills</LegendItem>
          <LegendItem tone="success">Income</LegendItem>
          <LegendItem tone="secondary">TaskMint withdrawal</LegendItem>
          <LegendItem tone="secondary" dashed>
            Expected withdrawal
          </LegendItem>
          <Typography variant="caption" color="text.secondary">
            ~ includes time tracked in TaskMint and not imported yet
          </Typography>
        </Box>
      </Paper>

      {open && <DayDialog day={open} today={today} onStep={step} onClose={() => setOpenDay(null)} />}
    </PageContainer>
  );
}
