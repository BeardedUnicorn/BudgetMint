// Adapted from TaskMint packages/client/src/components/pages/calendar/MonthGrid.tsx @ 1623bee.
/**
 * The Calendar's month as a grid of days, weeks from Sunday (or Monday, as
 * the settings say). One day is in
 * the tab order; the arrow keys move between days (into the next or
 * previous month when they run off this one), Home and End go to the week's
 * ends, Page Up and Page Down change month, and Enter or Space opens the day.
 */

import { KeyboardEvent, useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import type { CalendarDay, MonthView } from '@budgetmint/contracts';
import { PHONE } from '../../../theme/media';
import { addDays, addMonths, parseDay } from '../../../utils/dates';
import { formattingLocale } from '../../../utils/locale';
import { DayCell } from './DayCell';

const COLUMNS = { display: 'grid', gap: 0.5, gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' } as const;

/** The week's days from its first in the formatting locale (Nov 1 2026 is a Sunday). */
const weekdayName = (index: number, mondayFirst: boolean) =>
  new Date(2026, 10, 1 + index + (mondayFirst ? 1 : 0)).toLocaleDateString(formattingLocale(), { weekday: 'short' });

/** Which day of its week `date` is: 0 for the first (Sunday, or Monday). */
const dayOfWeek = (date: string, mondayFirst: boolean) => (parseDay(date).getDay() + (mondayFirst ? 6 : 0)) % 7;

/** Where a key moves the focus from `date`, or null for a key the grid doesn't use. */
export function keyTarget(key: string, date: string, mondayFirst = false): string | null {
  const weekday = dayOfWeek(date, mondayFirst);
  const moves: Record<string, () => string> = {
    ArrowLeft: () => addDays(date, -1),
    ArrowRight: () => addDays(date, 1),
    ArrowUp: () => addDays(date, -7),
    ArrowDown: () => addDays(date, 7),
    Home: () => addDays(date, -weekday),
    End: () => addDays(date, 6 - weekday),
    // The same day of the next month, or its last when shorter
    PageUp: () => `${addMonths(date.slice(0, 7), -1)}-${date.slice(8)}`,
    PageDown: () => `${addMonths(date.slice(0, 7), 1)}-${date.slice(8)}`,
  };
  const move = moves[key];
  if (!move) return null;
  const target = move();
  const month = target.slice(0, 7);
  // A day past the month's end (Jan 31 to February): its last day
  const last = addDays(`${addMonths(month, 1)}-01`, -1);
  // (Dates as text: the earlier sorts first)
  return [target, last].sort()[0];
}

/** The month's days in weeks from Sunday (or Monday), with null for the days of other months. */
export function weeksOf(days: CalendarDay[], mondayFirst = false): (CalendarDay | null)[][] {
  const cells: (CalendarDay | null)[] = [...Array(dayOfWeek(days[0].date, mondayFirst)).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

export interface MonthGridProps {
  view: MonthView;
  /** The day that's in the tab order (and keeps the focus across months). */
  focusedDate: string;
  onFocusDate: (date: string) => void;
  /** Moves to the month (YYYY-MM) a key ran into. */
  onMonthChange: (month: string) => void;
  onOpenDay: (date: string) => void;
  labelledBy: string;
  /** Weeks start on Monday (the settings'). */
  mondayFirst?: boolean;
}

export function MonthGrid({
  view,
  focusedDate,
  onFocusDate,
  onMonthChange,
  onOpenDay,
  labelledBy,
  mondayFirst = false,
}: MonthGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  // A key moved the focus: put it on the day once it's rendered
  const moveFocus = useRef(false);
  const shown = view.days.some(day => day.date === focusedDate);
  const tabbable = shown ? focusedDate : `${view.month}-01`;

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${tabbable}"]`)?.focus();
  }, [tabbable]);

  const handleKeyDown = (event: KeyboardEvent) => {
    const next = keyTarget(event.key, tabbable, mondayFirst);
    if (next === null) return;
    event.preventDefault();
    if (next === tabbable) return;
    moveFocus.current = true;
    onFocusDate(next);
    if (next.slice(0, 7) !== view.month) onMonthChange(next.slice(0, 7));
  };

  return (
    <Box sx={{ containerType: 'inline-size', containerName: 'calendar' }}>
      <Box role="grid" aria-labelledby={labelledBy} ref={gridRef} onKeyDown={handleKeyDown}>
        <Box role="row" sx={{ ...COLUMNS, mb: 0.5 }}>
          {[0, 1, 2, 3, 4, 5, 6].map(index => (
            <Typography
              key={index}
              role="columnheader"
              variant="caption"
              color="text.secondary"
              sx={{
                px: 1,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                [PHONE]: { px: 0, letterSpacing: 0, textAlign: 'center', fontSize: '0.65rem' },
              }}
            >
              {weekdayName(index, mondayFirst)}
            </Typography>
          ))}
        </Box>
        {weeksOf(view.days, mondayFirst).map(week => (
          <Box role="row" key={week.find(Boolean)!.date} sx={{ ...COLUMNS, mb: 0.5 }}>
            {week.map((day, index) =>
              day ? (
                <DayCell
                  key={day.date}
                  day={day}
                  isToday={day.date === view.today}
                  tabbable={day.date === tabbable}
                  onOpen={onOpenDay}
                  onFocusDay={onFocusDate}
                />
              ) : (
                <Box key={`blank-${index}`} role="gridcell" aria-hidden />
              )
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
