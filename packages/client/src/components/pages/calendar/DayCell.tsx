// Adapted from TaskMint packages/client/src/components/pages/calendar/DayCell.tsx @ 26aff93.
/**
 * One day on the Calendar: its date, the balance at its end, and badges for
 * the bills due, the income and TaskMint's money coming in (dashed while
 * it's only projected). A button that opens the day.
 *
 * Narrow grids show whole dollars and dots; wider ones (a container query on
 * the grid, see MonthGrid) show cents and labelled badges.
 */

import { ReactNode } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { alpha, Theme } from '@mui/material/styles';
import { BalanceFlag } from '../../budget/BalanceFlag';
import { CallMade as BillIcon, CallReceived as IncomeIcon, Savings as WithdrawalIcon } from '@mui/icons-material';
import type { CalendarDay } from '@budgetmint/contracts';
import { focusColor } from '../../../theme/components';
import { HOVER, PHONE } from '../../../theme/media';
import { formatLongDay, parseDay } from '../../../utils/dates';
import { formatCents, formatMaybeCents, formatWholeCents } from '../../../utils/money';

/** The grid is wide enough for cents and labelled badges. */
export const WIDE = '@container calendar (min-width: 640px)';

type Tone = 'error' | 'success' | 'secondary';

/** A tone's text colour that stays readable on its own tint, in either mode. */
const toneText = (tone: Tone) => (theme: Theme) =>
  theme.palette.mode === 'dark' ? theme.palette[tone].light : theme.palette[tone].dark;

/** The day in words, for screen readers. */
export function describeDay(day: CalendarDay): string {
  const { billsCents: bills, incomeCents: income } = day;
  const parts: string[] = [];
  if (bills > 0) parts.push(`bills ${formatCents(bills)}`);
  if (income > 0) parts.push(`income ${formatCents(income)}`);
  if (day.withdrawalCents > 0) {
    parts.push(
      `${day.withdrawalProjected ? 'TaskMint withdrawal expected' : 'TaskMint withdrawal'} ${formatCents(day.withdrawalCents)}`
    );
  }
  if (day.closingCents !== null)
    parts.push(`balance ${formatCents(day.closingCents)}${day.short ? ', below zero' : day.low ? ', low' : ''}`);
  return `${formatLongDay(day.date)}: ${parts.length > 0 ? parts.join('; ') : 'nothing due'}`;
}

function Badge({
  tone,
  dashed = false,
  icon,
  children,
}: {
  tone: Tone;
  dashed?: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Box
      sx={theme => ({
        display: 'none',
        [WIDE]: { display: 'flex' },
        alignItems: 'center',
        gap: 0.5,
        minWidth: 0,
        px: 0.75,
        py: '1px',
        borderRadius: 1,
        border: `1px ${dashed ? 'dashed' : 'solid'} ${alpha(theme.palette[tone].main, dashed ? 0.7 : 0)}`,
        bgcolor: dashed ? 'transparent' : alpha(theme.palette[tone].main, 0.14),
        color: toneText(tone)(theme),
        '& svg': { fontSize: 13, flexShrink: 0 },
      })}
    >
      {icon}
      <Typography
        variant="caption"
        sx={{ fontWeight: 600, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {children}
      </Typography>
    </Box>
  );
}

/** A dot's shape says what it is too, not only its color: bills round, income a diamond, withdrawals square. */
const DOT_SHAPES = {
  error: { borderRadius: '50%' },
  success: { borderRadius: '1px', transform: 'rotate(45deg)' },
  secondary: { borderRadius: '1px' },
} as const;

function Dot({ tone, hollow = false }: { tone: Tone; hollow?: boolean }) {
  return (
    <Box
      data-dot={tone}
      sx={theme => ({
        width: 7,
        height: 7,
        ...DOT_SHAPES[tone],
        bgcolor: hollow ? 'transparent' : theme.palette[tone].main,
        border: `1.5px solid ${theme.palette[tone].main}`,
      })}
    />
  );
}

export interface DayCellProps {
  day: CalendarDay;
  isToday: boolean;
  /** In the tab order (the grid's one tabbable day). */
  tabbable: boolean;
  onOpen: (date: string) => void;
  onFocusDay: (date: string) => void;
}

export function DayCell({ day, isToday, tabbable, onOpen, onFocusDay }: DayCellProps) {
  const { billsCents: bills, incomeCents: income } = day;
  const uncertain = day.withdrawalUncertainCents > 0;
  const busy = bills > 0 || income > 0 || day.withdrawalCents > 0;

  return (
    <Box role="gridcell" sx={{ minWidth: 0 }}>
      <ButtonBase
        data-date={day.date}
        tabIndex={tabbable ? 0 : -1}
        aria-label={describeDay(day)}
        onClick={() => onOpen(day.date)}
        onFocus={() => onFocusDay(day.date)}
        sx={theme => ({
          width: '100%',
          height: '100%',
          minHeight: 72,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          justifyContent: 'flex-start',
          gap: 0.5,
          p: 0.75,
          textAlign: 'left',
          borderRadius: 1,
          border: `1px solid ${isToday ? theme.palette.primary.main : theme.palette.divider}`,
          bgcolor: day.short ? alpha(theme.palette.error.main, 0.07) : 'transparent',
          transition: theme.transitions.create(['background-color', 'border-color'], { duration: 120 }),
          [HOVER]: { '&:hover': { bgcolor: theme.palette.action.hover } },
          '&:focus-visible': { outline: `2px solid ${focusColor(theme.palette.mode)}`, outlineOffset: 1 },
          [WIDE]: { minHeight: 112, p: 1 },
          [PHONE]: { minHeight: 52, p: 0.5 },
        })}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 0.5 }}>
          <Box
            sx={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              typography: 'body2',
              fontWeight: isToday ? 700 : 600,
              color: isToday ? 'primary.contrastText' : 'text.primary',
              bgcolor: isToday ? 'primary.main' : 'transparent',
              [PHONE]: { width: 20, height: 20, fontSize: '0.75rem' },
            }}
          >
            {parseDay(day.date).getDate()}
          </Box>
          {/* Dots where there's no room for badges */}
          <Box sx={{ display: 'flex', gap: 0.25, [WIDE]: { display: 'none' } }}>
            {bills > 0 && <Dot tone="error" />}
            {income > 0 && <Dot tone="success" />}
            {day.withdrawalCents > 0 && <Dot tone="secondary" hollow={day.withdrawalProjected} />}
          </Box>
        </Box>
        {bills > 0 && (
          <Badge tone="error" icon={<BillIcon />}>
            {formatCents(bills)}
          </Badge>
        )}
        {income > 0 && (
          <Badge tone="success" icon={<IncomeIcon />}>
            {formatCents(income)}
          </Badge>
        )}
        {day.withdrawalCents > 0 && (
          <Badge tone="secondary" dashed={day.withdrawalProjected} icon={<WithdrawalIcon />}>
            {formatMaybeCents(day.withdrawalCents, uncertain)}
          </Badge>
        )}
        {day.closingCents !== null && (busy || isToday) && (
          <Typography
            component="div"
            sx={{
              mt: 'auto',
              fontFamily: '"Roboto Mono", monospace',
              fontWeight: 600,
              fontSize: '0.75rem',
              color: day.short ? 'error.main' : day.low ? 'warning.main' : 'text.secondary',
              [PHONE]: { display: 'none' },
            }}
          >
            <BalanceFlag short={day.short} low={day.low} hidden />
            <Box component="span" sx={{ [WIDE]: { display: 'none' } }}>
              {formatWholeCents(day.closingCents)}
            </Box>
            <Box component="span" sx={{ display: 'none', [WIDE]: { display: 'inline' } }}>
              {formatCents(day.closingCents)}
            </Box>
          </Typography>
        )}
      </ButtonBase>
    </Box>
  );
}
