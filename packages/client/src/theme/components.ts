// Adapted from TaskMint packages/client/src/theme/components.ts @ 1623bee: the focus ring is darker on light surfaces.
/**
 * Component defaults for both modes: visible focus rings, comfortable touch
 * targets (44px, 32px for small controls with a mouse), the few looks that
 * differ by mode (shadows, card edges, default chips), and dialogs that fit
 * a phone.
 */

import type { Components, Theme } from '@mui/material/styles';
import { PHONE, TOUCH } from './media';
import { BRAND, BRAND_TEXT_LIGHT, ColorMode } from './palettes';

/** The focus ring's color (and a focused field's edge): the brand green, darker on light surfaces where it would fade. */
export const focusColor = (mode: ColorMode) => (mode === 'light' ? BRAND_TEXT_LIGHT : BRAND);

const SHADOWS: Record<ColorMode, [string, string, string]> = {
  light: [
    '0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24)',
    '0 3px 6px rgba(0, 0, 0, 0.16), 0 3px 6px rgba(0, 0, 0, 0.23)',
    '0 10px 20px rgba(0, 0, 0, 0.19), 0 6px 6px rgba(0, 0, 0, 0.23)',
  ],
  dark: [
    '0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.4)',
    '0 3px 6px rgba(0, 0, 0, 0.4), 0 3px 6px rgba(0, 0, 0, 0.5)',
    '0 10px 20px rgba(0, 0, 0, 0.5), 0 6px 6px rgba(0, 0, 0, 0.6)',
  ],
};

export function components(mode: ColorMode): Components<Theme> {
  const light = mode === 'light';
  const [shadow1, shadow2, shadow3] = SHADOWS[mode];
  const ring = focusColor(mode);
  const focusRing = (offset: string) => ({
    '&:focus-visible': { outline: `2px solid ${ring}`, outlineOffset: offset },
  });

  return {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          ...(light && { boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)', border: '1px solid rgba(0, 0, 0, 0.08)' }),
          ...focusRing('2px'),
        },
      },
    },
    MuiButton: {
      // No aria-label default: it OVERRIDES the visible text as the
      // accessible name, so every unlabeled button was announced as "Button".
      styleOverrides: {
        root: ({ theme }) => ({
          textTransform: 'none',
          borderRadius: theme.shape.borderRadius,
          minHeight: 44,
          padding: '8px 16px',
          ...focusRing('2px'),
        }),
        // A finger needs the full target even on a small button
        sizeSmall: { minHeight: 32, padding: '4px 10px', [TOUCH]: { minHeight: 44 } },
        // Hover tint for text buttons only: on root it also replaced the
        // contained buttons' fill (a red Delete went see-through on hover).
        text: { '&:hover': { backgroundColor: 'rgba(101, 214, 161, 0.08)' } },
        contained: {
          boxShadow: light ? '0 2px 4px rgba(0, 0, 0, 0.1)' : '0 2px 4px rgba(0, 0, 0, 0.2)',
          '&:hover': { boxShadow: light ? '0 4px 8px rgba(0, 0, 0, 0.15)' : '0 4px 8px rgba(0, 0, 0, 0.3)' },
        },
      },
      // The brand green is too light for text on white
      variants: light
        ? [
            { props: { variant: 'text', color: 'primary' }, style: { color: BRAND_TEXT_LIGHT } },
            { props: { variant: 'outlined', color: 'primary' }, style: { color: BRAND_TEXT_LIGHT } },
          ]
        : [],
    },
    MuiIconButton: {
      // No aria-label default: a generic "Icon button" name suppresses the
      // Tooltip-derived name and hides which control this actually is.
      styleOverrides: {
        root: { minWidth: 44, minHeight: 44, ...focusRing('2px') },
        sizeSmall: { minWidth: 32, minHeight: 32, [TOUCH]: { minWidth: 44, minHeight: 44 } },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            '&:focus-within .MuiOutlinedInput-notchedOutline': { borderColor: ring, borderWidth: '2px' },
            '&.MuiInputBase-multiline': {
              padding: '12px 14px',
              alignItems: 'flex-start',
              '& .MuiInputBase-input': {
                resize: 'vertical',
                minHeight: 'auto',
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
                lineHeight: 1.5,
              },
            },
          },
          '& .MuiInputLabel-root.MuiInputLabel-outlined.MuiInputLabel-shrink': {
            transform: 'translate(14px, -9px) scale(0.75)',
          },
        },
      },
    },
    MuiTab: { styleOverrides: { root: { minHeight: 48, ...focusRing('2px') } } },
    MuiMenuItem: { styleOverrides: { root: { minHeight: 44, ...focusRing('-2px') } } },
    MuiListItem: { styleOverrides: { root: { minHeight: 44, ...focusRing('-2px') } } },
    MuiTableCell: {
      styleOverrides: {
        root: ({ theme }) => ({ borderBottom: `1px solid ${theme.palette.divider}`, ...focusRing('-2px') }),
        head: ({ theme }) => ({ fontWeight: 600, backgroundColor: theme.palette.action.hover }),
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          ...focusRing('2px'),
          // On a phone a dialog takes the screen's width; a wide one (md and
          // up: notes, a calendar day, an import) takes the whole screen,
          // clear of the system bars.
          [PHONE]: {
            margin: 16,
            maxWidth: 'calc(100% - 32px)',
            '&.MuiDialog-paperFullWidth': { width: 'calc(100% - 32px)' },
            '&.MuiDialog-paperScrollPaper': { maxHeight: 'calc(100% - 32px)' },
            '&.MuiDialog-paperWidthMd, &.MuiDialog-paperWidthLg, &.MuiDialog-paperWidthXl': {
              margin: 0,
              width: '100%',
              maxWidth: '100%',
              height: '100%',
              maxHeight: '100%',
              borderRadius: 0,
              paddingTop: 'env(safe-area-inset-top)',
              paddingBottom: 'env(safe-area-inset-bottom)',
            },
          },
        },
      },
    },
    // Too many buttons for one row on a phone wrap, right-aligned
    MuiDialogActions: {
      styleOverrides: {
        root: { [PHONE]: { flexWrap: 'wrap', gap: 8, '& > :not(style) ~ :not(style)': { marginLeft: 0 } } },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          fontSize: '0.875rem',
          backgroundColor: light ? 'rgba(0, 0, 0, 0.87)' : 'rgba(0, 0, 0, 0.9)',
          color: '#ffffff',
          maxWidth: 300,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        elevation1: { boxShadow: shadow1 },
        elevation2: { boxShadow: shadow2 },
        elevation3: { boxShadow: shadow3 },
      },
    },
    // Light mode's default chips are brand-tinted; colored chips keep their
    // palette colors
    MuiChip: {
      variants: light
        ? [
            {
              props: { color: 'default', variant: 'filled' },
              style: {
                backgroundColor: 'rgba(101, 214, 161, 0.12)',
                color: BRAND_TEXT_LIGHT,
                '&.MuiChip-clickable:hover': { backgroundColor: 'rgba(101, 214, 161, 0.2)' },
              },
            },
          ]
        : [],
    },
  };
}
