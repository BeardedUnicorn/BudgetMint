/**
 * Calendar: a month of bills, income and (with TaskMint connected) its
 * withdrawals and each work day's earnings not withdrawn yet, with each
 * day's closing balance; the month's totals above, a day's details a click
 * away.
 */

import { ReactNode, useId, useState } from 'react';
import { Box, Button, IconButton, Paper, Typography } from '@mui/material';
import { ChevronLeft, ChevronRight } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { useCoreQuery } from '../../../data/BudgetContext';
import { useCompactLayout } from '../../../hooks/useCompactLayout';
import { useTaskMint } from '../../../hooks/useTaskMint';
import { PHONE } from '../../../theme/media';
import { addDays, addMonths, formatLongDay, formatMonth } from '../../../utils/dates';
import { formatCents } from '../../../utils/money';
import { PageContainer, PageHeader } from '../../layout/PageLayout';
import { Dot, WIDE } from './DayCell';
import { DayAgenda, DayDialog } from './DayDialog';
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

/**
 * A legend's line: the badge it stands for where the grid has badges, and
 * the dot where it has dots (the legend is a container of the same width,
 * so the grid's own query picks).
 */
function LegendItem({
  tone,
  dashed = false,
  dotted = false,
  dot,
  children,
}: {
  tone: 'error' | 'success' | 'secondary';
  dashed?: boolean;
  dotted?: boolean;
  dot: ReactNode;
  children: string;
}) {
  const outlined = dashed || dotted;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <Box sx={{ display: 'flex', width: 14, justifyContent: 'center', [WIDE]: { display: 'none' } }}>{dot}</Box>
      <Box
        sx={theme => ({
          display: 'none',
          width: 14,
          height: 10,
          borderRadius: 0.5,
          border: `1px ${dotted ? 'dotted' : dashed ? 'dashed' : 'solid'} ${theme.palette[tone].main}`,
          bgcolor: outlined ? 'transparent' : alpha(theme.palette[tone].main, 0.3),
          [WIDE]: { display: 'block' },
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
  const { settings } = useCoreQuery('get_settings');
  const view = useCoreQuery('get_month', { month });
  const titleId = useId();
  const open = view.days.find(day => day.date === openDay);
  const { shown: taskmintShown } = useTaskMint();
  // A phone shows the day picked under the month, where there's room, rather than over it
  const compact = useCompactLayout();
  const [picked, setPicked] = useState(today);
  const pickedDay = view.days.find(day => day.date === picked);

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
        subtitle={
          taskmintShown
            ? 'Bills, income, and TaskMint’s earnings and withdrawals, with the balance each day ends on.'
            : 'Bills and income, with the balance each day ends on.'
        }
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
            {taskmintShown && <Stat label="TaskMint" value={formatCents(view.withdrawalsCents)} />}
          </Box>
        </Box>

        <MonthGrid
          view={view}
          focusedDate={focusedDate}
          onFocusDate={setFocusedDate}
          onMonthChange={setMonth}
          onOpenDay={compact ? setPicked : setOpenDay}
          selectedDate={compact ? picked : undefined}
          labelledBy={titleId}
          mondayFirst={settings.weekStartsMonday}
        />

        <Box sx={{ containerType: 'inline-size', containerName: 'calendar', mt: 2 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            <LegendItem tone="error" dot={<Dot tone="error" />}>
              Bills
            </LegendItem>
            <LegendItem tone="success" dot={<Dot tone="success" />}>
              Income
            </LegendItem>
            {taskmintShown && (
              <>
                <LegendItem tone="secondary" dot={<Dot tone="secondary" />}>
                  TaskMint withdrawal
                </LegendItem>
                <LegendItem tone="secondary" dashed dot={<Dot tone="secondary" hollow />}>
                  Expected withdrawal
                </LegendItem>
                <LegendItem tone="secondary" dotted dot={<Dot tone="secondary" shape="earned" />}>
                  Earned, not withdrawn yet
                </LegendItem>
                <Typography variant="caption" color="text.secondary">
                  ~ includes time tracked in TaskMint and not imported yet
                </Typography>
              </>
            )}
          </Box>
        </Box>
      </Paper>

      {compact && pickedDay && (
        <Paper component="section" aria-labelledby="picked-title" sx={{ p: 2, mt: 2 }}>
          <Typography id="picked-title" variant="h6" component="h2" sx={{ mb: 1 }}>
            {formatLongDay(pickedDay.date)}
          </Typography>
          <DayAgenda day={pickedDay} today={today} />
        </Paper>
      )}
      {open && <DayDialog day={open} today={today} onStep={step} onClose={() => setOpenDay(null)} />}
    </PageContainer>
  );
}
