// Copied from TaskMint packages/client/src/theme/base.ts @ 1623bee: keep the two in step.
/**
 * Shape and type, the same in both modes.
 */

import type { ThemeOptions } from '@mui/material/styles';

export const shape: ThemeOptions['shape'] = { borderRadius: 12 };

const heading = (fontSize: string, lineHeight: number) => ({ fontSize, fontWeight: 600, lineHeight });

export const typography: ThemeOptions['typography'] = {
  fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSize: 14,
  // No per-variant colors: text color comes from the palette, so Typography
  // inherits contrastText on colored surfaces.
  h1: heading('2.5rem', 1.2),
  h2: heading('2rem', 1.3),
  h3: heading('1.75rem', 1.3),
  h4: heading('1.5rem', 1.4),
  h5: heading('1.25rem', 1.4),
  h6: heading('1.125rem', 1.4),
  body1: { fontSize: '1rem', lineHeight: 1.5 },
  body2: { fontSize: '0.875rem', lineHeight: 1.5 },
  button: { fontSize: '0.875rem', fontWeight: 500, textTransform: 'none' },
};
