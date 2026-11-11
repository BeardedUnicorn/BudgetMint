// Adapted from TaskMint packages/client/src/theme/palettes.ts @ 1623bee: the dark palette's colors read too (4.5:1).
/**
 * The light and dark palettes. Shared brand colors; each mode's text colors
 * read on its surfaces, and the text on a filled chip or button reads on its
 * fill (4.5:1, checked by palettes.test).
 */

import type { PaletteOptions } from '@mui/material/styles';

export type ColorMode = 'light' | 'dark';

/** The brand green. Text in it on a light surface uses BRAND_TEXT_LIGHT. */
export const BRAND = '#65D6A1';
/** Brand-green text that reads on a light surface. */
export const BRAND_TEXT_LIGHT = '#1F6F4A';

const brand = {
  primary: { main: BRAND, dark: '#4CAF50', light: '#B2DFDB' },
  secondary: { main: '#0D7377', dark: '#004D40', light: '#4DB6AC' },
};

export const palettes: Record<ColorMode, PaletteOptions> = {
  light: {
    mode: 'light',
    ...brand,
    background: { default: '#FAFAFA', paper: '#ffffff' },
    text: { primary: '#3F4E4F', secondary: '#616161' },
    error: { main: '#D32F2F', contrastText: '#ffffff' },
    warning: { main: '#A15C00', dark: '#8A5300', contrastText: '#ffffff' },
    info: { main: '#0277BD', contrastText: '#ffffff' },
    success: { main: '#2E7D32', contrastText: '#ffffff' },
    divider: 'rgba(0, 0, 0, 0.12)',
  },
  dark: {
    mode: 'dark',
    ...brand,
    // The brand teal is too dark to read on a dark surface: its light shade stands in
    secondary: { main: '#4DB6AC', dark: '#0D7377', light: '#80CBC4', contrastText: '#000000' },
    background: { default: '#121212', paper: '#1e1e1e' },
    text: { primary: '#FAFAFA', secondary: '#b0b0b0' },
    // These are bright: dark text reads on them, white doesn't
    error: { main: '#FF5C5C', contrastText: '#000000' },
    warning: { main: '#FFD700', contrastText: '#000000' },
    info: { main: '#2196f3', contrastText: '#000000' },
    success: { main: '#32CD32', contrastText: '#000000' },
    divider: 'rgba(255, 255, 255, 0.12)',
  },
};
