/**
 * An amount in the settings, saved once it's typed (on leaving the field),
 * not at each key. Until it's typed in, it shows what's saved, so a change
 * made on another device shows here and isn't written back over.
 */

import { useState } from 'react';
import type { SxProps, Theme } from '@mui/material';
import { centsToInput, parseDollars } from '../../../utils/money';
import { CurrencyInput } from '../../ui/forms/CurrencyInput';

export function AmountSetting({
  label,
  cents,
  onSave,
  helperText,
  sx,
}: {
  label: string;
  /** The saved amount; zero is none (an empty field). */
  cents: number;
  onSave: (cents: number) => void;
  helperText?: string;
  sx?: SxProps<Theme>;
}) {
  /** What's typed and not yet saved; null when nothing is. */
  const [typed, setTyped] = useState<string | null>(null);
  const leave = () => {
    if (typed === null) return;
    // Emptied: none. Not an amount yet (a lone point): kept as typed, unsaved
    const parsed = typed === '' ? 0 : parseDollars(typed);
    if (parsed === null) return;
    onSave(parsed);
    setTyped(null);
  };
  return (
    <CurrencyInput
      label={label}
      value={typed ?? centsToInput(cents || null)}
      onChange={setTyped}
      onBlur={leave}
      helperText={helperText}
      error={false}
      sx={sx}
    />
  );
}
