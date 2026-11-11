// Copied from TaskMint packages/client/src/theme/__tests__/palettes.test.ts @ 1623bee: keep the two in step.
import { describe, it, expect } from 'vitest';
import { getContrastRatio } from '@mui/material/styles';
import { createAppTheme } from '..';
import { BRAND_TEXT_LIGHT } from '../palettes';

/** WCAG AA for body text. */
const AA = 4.5;

describe('light palette contrast', () => {
  const { palette } = createAppTheme('light');
  const surfaces = [palette.background.paper, palette.background.default];

  it.each(['primary', 'secondary'] as const)('%s text reads on light surfaces', key => {
    for (const surface of surfaces) {
      expect(getContrastRatio(palette.text[key], surface)).toBeGreaterThanOrEqual(AA);
    }
  });

  it.each(['error', 'warning', 'info', 'success'] as const)(
    '%s reads as text, and its contrast text reads on it',
    key => {
      for (const surface of surfaces) {
        expect(getContrastRatio(palette[key].main, surface)).toBeGreaterThanOrEqual(AA);
      }
      expect(getContrastRatio(palette[key].contrastText, palette[key].main)).toBeGreaterThanOrEqual(AA);
    }
  );

  it('uses a readable green for brand-colored text', () => {
    expect(getContrastRatio(BRAND_TEXT_LIGHT, palette.background.paper)).toBeGreaterThanOrEqual(AA);
  });
});

describe('createAppTheme', () => {
  it('builds each mode with its own palette', () => {
    expect(createAppTheme('light').palette.mode).toBe('light');
    expect(createAppTheme('dark').palette.mode).toBe('dark');
    expect(createAppTheme('dark').palette.background.default).toBe('#121212');
  });

  it('publishes the palette as CSS variables', () => {
    const theme = createAppTheme('dark');
    expect(theme.vars?.palette.background.paper).toMatch(/^var\(--mui-palette-background-paper/);
  });
});
