/**
 * An amount in the settings, saved once it's typed (on leaving the field),
 * not at each key. Until it's typed in, it shows what's saved, so a change
 * made on another device shows here and isn't written back over. It says
 * Saved for a moment when it saves, and says so when what's typed can't be.
 */

import { useEffect, useState } from 'react';
import type { SxProps, Theme } from '@mui/material';
import { centsToInput, parseDollars } from '../../../utils/money';
import { CurrencyInput } from '../../ui/forms/CurrencyInput';
import { VISUALLY_HIDDEN } from '../../ui/visuallyHidden';

/** How long it says Saved. */
const SAVED_MS = 2_500;

const NOT_AN_AMOUNT = 'That isn’t an amount, so it wasn’t saved. Type one like 12.50.';

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
  /** What was typed and left isn't an amount, so it wasn't saved. */
  const [refused, setRefused] = useState(false);
  /** It has just saved. */
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), SAVED_MS);
    return () => clearTimeout(timer);
  }, [saved]);
  const leave = () => {
    if (typed === null) return;
    // Emptied: none. Not an amount (a lone point): kept as typed, unsaved, and said
    const parsed = typed === '' ? 0 : parseDollars(typed);
    if (parsed === null) {
      setRefused(true);
      return;
    }
    onSave(parsed);
    setTyped(null);
    setSaved(true);
  };
  return (
    <>
      <CurrencyInput
        label={label}
        value={typed ?? centsToInput(cents || null)}
        onChange={amount => {
          setTyped(amount);
          setRefused(false);
          setSaved(false);
        }}
        onBlur={leave}
        helperText={refused ? NOT_AN_AMOUNT : saved ? 'Saved' : helperText}
        error={refused}
        sx={sx}
      />
      {/* Said to a screen reader as it saves; the helper text is only read with the field */}
      <span role="status" style={VISUALLY_HIDDEN}>
        {saved ? 'Saved' : ''}
      </span>
    </>
  );
}
