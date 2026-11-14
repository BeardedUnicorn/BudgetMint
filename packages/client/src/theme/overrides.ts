/**
 * BudgetMint's own component defaults, merged over the theme it shares with
 * TaskMint (components.ts, a copy): what BudgetMint's screens need and
 * TaskMint's theme doesn't set.
 */

import type { Components, Theme } from '@mui/material/styles';
import { focusColor } from './components';
import { KEYBOARD, SAFE_LEFT, SAFE_RIGHT, SAFE_TOP } from './layout';
import { PHONE, SAFE_BOTTOM } from './media';
import type { ColorMode } from './palettes';

export function overrides(mode: ColorMode): Components<Theme> {
  const ring = (offset: string) => ({
    '&:focus-visible': { outline: `2px solid ${focusColor(mode)}`, outlineOffset: offset },
  });
  return {
    // A dialog keeps clear of what the system draws over the app on a phone: the status bar
    // (a tall form's title was under the clock), the navigation bar, the keyboard, and the
    // sides of a phone turned over. The copied theme keeps it clear of the keyboard alone, and
    // pads its full-screen dialogs for the bars, which here they no longer reach.
    MuiDialog: {
      styleOverrides: {
        root: {
          top: `max(var(--keyboard-top, 0px), ${SAFE_TOP})`,
          right: SAFE_RIGHT,
          bottom: `max(${KEYBOARD}, ${SAFE_BOTTOM})`,
          left: SAFE_LEFT,
        },
        paper: {
          [PHONE]: {
            '&.MuiDialog-paperWidthMd, &.MuiDialog-paperWidthLg, &.MuiDialog-paperWidthXl': {
              paddingTop: 0,
              paddingBottom: 0,
            },
          },
        },
      },
    },
    // A dialog's buttons end where its fields do, not 16px further out
    MuiDialogActions: { styleOverrides: { root: { padding: '4px 24px 20px' } } },
    // The sidebar's pages and the phone's tabs show where the keyboard is
    MuiListItemButton: { styleOverrides: { root: ring('-2px') } },
    MuiBottomNavigationAction: { styleOverrides: { root: ring('-2px') } },
  };
}
