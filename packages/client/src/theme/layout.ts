/**
 * Layout the pages share: the figures' typeface, a section's padding, and
 * the grid of stat cards. BudgetMint's own (TaskMint has no counterpart).
 */

import type { Theme } from '@mui/material/styles';
import { focusColor } from './components';
import { PHONE } from './media';

/** Money is set in Roboto Mono, so figures line up digit under digit. */
export const MONO = '"Roboto Mono", monospace';

/** The keyboard's ring, for what the theme's own rings don't reach (a ButtonBase, a focusable figure). */
export const FOCUS_RING = (theme: Theme) => ({
  '&:focus-visible': { outline: `2px solid ${focusColor(theme.palette.mode)}`, outlineOffset: 2 },
});

/** A page's section: a Paper's padding and the gap below it. */
export const SECTION = { p: 3, mb: 4, [PHONE]: { p: 2, mb: 3 } } as const;

/** Wide enough for three stat cards beside the sidebar, each with room for a figure in the hundred thousands. */
const THREE_ACROSS = '@media (min-width:1200px)';
/** Wide enough for four. */
const FOUR_ACROSS = '@media (min-width:1536px)';

/**
 * The stat cards under a page's header. No card is left alone on a row:
 * three go side by side or two and one full width, four go four across or
 * two by two.
 */
export const STATS_GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 3,
  mb: 4,
  // The odd one out takes the whole row
  '& > :last-child:nth-child(odd)': { gridColumn: '1 / -1' },
  [THREE_ACROSS]: {
    '&:has(> :nth-child(3):last-child)': {
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      '& > :last-child': { gridColumn: 'auto' },
    },
  },
  [FOUR_ACROSS]: {
    '&:has(> :nth-child(4):last-child)': { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' },
  },
  [PHONE]: { gap: 2, mb: 3 },
} as const;
