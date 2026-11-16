/**
 * How the settings' fields are laid out: boxes of a set width that take the
 * whole width on a phone, with their helper text free to run on past the
 * box, so a sentence under a short field doesn't wrap every four words.
 */

import { PHONE } from '../../../theme/media';

/** A field on a line of its own: its box `width` wide, its helper text as wide as the section. */
export const settingField = (width: number) =>
  ({
    width: '100%',
    '& .MuiInputBase-root': { maxWidth: width },
    [PHONE]: { '& .MuiInputBase-root': { maxWidth: 'none' } },
  }) as const;

/** A field among others on a row that wraps: about `width` wide, sharing the row's width on a phone. */
export const rowField = (width: number) =>
  ({
    flex: `1 1 ${width}px`,
    minWidth: 0,
    maxWidth: width + 60,
    [PHONE]: { maxWidth: 'none' },
  }) as const;

/** Words beside the button that acts on them: side by side, and on a phone the button under the words. */
export const WORDS_AND_BUTTON = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  [PHONE]: { flexDirection: 'column', alignItems: 'flex-start', gap: 1 },
} as const;
