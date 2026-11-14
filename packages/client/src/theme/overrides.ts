/**
 * BudgetMint's own component defaults, merged over the theme it shares with
 * TaskMint (components.ts, a copy): what BudgetMint's screens need and
 * TaskMint's theme doesn't set.
 */

import type { Components, Theme } from '@mui/material/styles';
import { focusColor } from './components';
import type { ColorMode } from './palettes';

export function overrides(mode: ColorMode): Components<Theme> {
  const ring = (offset: string) => ({
    '&:focus-visible': { outline: `2px solid ${focusColor(mode)}`, outlineOffset: offset },
  });
  return {
    // A dialog's buttons end where its fields do, not 16px further out
    MuiDialogActions: { styleOverrides: { root: { padding: '4px 24px 20px' } } },
    // The sidebar's pages and the phone's tabs show where the keyboard is
    MuiListItemButton: { styleOverrides: { root: ring('-2px') } },
    MuiBottomNavigationAction: { styleOverrides: { root: ring('-2px') } },
  };
}
