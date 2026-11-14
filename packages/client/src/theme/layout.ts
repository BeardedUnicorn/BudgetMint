/**
 * Layout the pages share: the figures' typeface, a section's padding, and
 * the grid of stat cards. BudgetMint's own (TaskMint has no counterpart).
 */

import type { Theme } from '@mui/material/styles';
import { focusColor } from './components';
import { PHONE, SAFE_BOTTOM } from './media';

/**
 * The room to leave along the top and sides for a phone's status bar,
 * navigation bar and camera cutout, which the app draws under: what the
 * browser says, or what Android does where its webview says nothing
 * (useSystemInsets). The bottom's is SAFE_BOTTOM (theme/media).
 */
export const SAFE_TOP = 'max(env(safe-area-inset-top, 0px), var(--system-top-inset, 0px))';
export const SAFE_LEFT = 'max(env(safe-area-inset-left, 0px), var(--system-left-inset, 0px))';
export const SAFE_RIGHT = 'max(env(safe-area-inset-right, 0px), var(--system-right-inset, 0px))';

/** The room the on-screen keyboard takes from the bottom (useKeyboardInset). */
export const KEYBOARD = 'var(--keyboard-bottom, 0px)';

/**
 * The bottom's room while the keyboard may be up: the keyboard's own inset
 * is from the screen's edge, over the navigation bar, so what stands on the
 * keyboard leaves no second gap for the bar under it.
 */
export const SAFE_BOTTOM_OVER_KEYBOARD = `max(0px, calc(${SAFE_BOTTOM} - ${KEYBOARD}))`;

/**
 * A page outside the app's frame (signing in, the welcome steps, loading):
 * the screen's height with its card in the middle, clear of the system's
 * bars, and of the keyboard, so a field under it can be scrolled into view.
 */
export const OUTSIDE_PAGE = {
  boxSizing: 'border-box',
  minHeight: '100vh',
  '@supports (height: 100dvh)': { minHeight: '100dvh' },
  display: 'grid',
  placeItems: 'center',
  pt: `calc(16px + ${SAFE_TOP})`,
  pr: `calc(16px + ${SAFE_RIGHT})`,
  pb: `calc(16px + max(${SAFE_BOTTOM}, ${KEYBOARD}))`,
  pl: `calc(16px + ${SAFE_LEFT})`,
} as const;

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
