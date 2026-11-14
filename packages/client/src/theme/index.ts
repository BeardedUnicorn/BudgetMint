// Adapted from TaskMint packages/client/src/theme/index.ts @ 1623bee: merges BudgetMint's own component defaults (overrides.ts) over the shared ones.
/**
 * The app theme, light or dark. Each mode's palette is published as CSS
 * variables (--mui-palette-*), so plain CSS (the calendar's styles.css)
 * follows the chosen mode, not just the system's.
 */

import { createTheme, Theme } from '@mui/material/styles';
import { shape, typography } from './base';
import { components } from './components';
import { overrides } from './overrides';
import { ColorMode, palettes } from './palettes';

export type { ColorMode };

export function createAppTheme(mode: ColorMode): Theme {
  return createTheme(
    {
      cssVariables: true,
      palette: palettes[mode],
      shape,
      typography,
      components: components(mode),
    },
    { components: overrides(mode) }
  );
}
