// Adapted from TaskMint packages/client/src/components/ui/forms/CurrencyInput.tsx @ 1623bee: it takes a ref to its input, and can start with the focus; it reads either decimal mark, and writes the amount out in full when it's left.
import React, { useState } from 'react';
import { TextField, InputAdornment } from '@mui/material';
import { LIMITS } from '@budgetmint/contracts';
import { CurrencyInputProps } from '../../../types/ui';
import { formattingLocale } from '../../../utils/locale';
import { currencySymbol } from '../../../utils/money';

/** The largest amount the field takes: core's. */
export const MAX_AMOUNT = LIMITS.MAX_CENTS / 100;

/** What an amount is typed with: digits and the two marks. */
const typedAmount = (text: string) => text.replace(/[^\d.,]/g, '');

/**
 * An amount as typed, kept to what's valid: digits and one decimal point, at
 * most two decimals, at most MAX_AMOUNT. (No minus sign, so never negative.)
 *
 * Either mark may be the decimal one, read as parseDollars reads them: the
 * last mark is, before one or two digits ("135,50", "1.820,00") or none yet
 * ("135,"), and the marks before it group thousands. Before three digits or
 * more it groups too ("1,820", "1,234,567"), unless it's a point alone or the
 * later of the two kinds: then it's the decimal mark with too many decimals,
 * which are dropped ("12.345") rather than made into thousands by a slip.
 */
export function cleanAmount(text: string): string {
  const typed = typedAmount(text);
  const last = Math.max(typed.lastIndexOf('.'), typed.lastIndexOf(','));
  const digits = (part: string) => part.replace(/[.,]/g, '');
  let amount = digits(typed);
  if (last >= 0) {
    const mark = typed[last];
    const after = typed.slice(last + 1);
    const once = typed.indexOf(mark) === last;
    const alone = !typed.includes(mark === '.' ? ',' : '.');
    if (after.length <= 2 || (once && (mark === '.' || !alone))) {
      amount = `${digits(typed.slice(0, last))}.${after.slice(0, 2)}`;
    }
  }
  return parseFloat(amount) > MAX_AMOUNT ? String(MAX_AMOUNT) : amount;
}

/**
 * A kept amount written out in full, as the locale writes it ("13,550.00"),
 * so a slip shows; what isn't a number yet (none, a lone point) as it is.
 * In Latin digits, which are what cleanAmount reads back.
 */
function writtenAmount(amount: string): string {
  const number = Number(amount);
  if (amount === '' || Number.isNaN(number)) return amount;
  return new Intl.NumberFormat(formattingLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    numberingSystem: 'latn',
  }).format(number);
}

/**
 * An amount field, in the settings' currency. Its value is the kept amount
 * ("1820.5"); while it's typed in, the field shows what was typed, marks
 * and all, and once it's left, the amount in full.
 */
export function CurrencyInput({
  value,
  onChange,
  label,
  error,
  helperText,
  disabled,
  sx,
  onBlur,
  onKeyDown,
  inputRef,
  autoFocus,
}: CurrencyInputProps) {
  /** What's being typed; null once the field is left. */
  const [typing, setTyping] = useState<string | null>(null);
  // Shown only while it's still what the value was kept from: a value set from outside wins
  const shown = typing !== null && cleanAmount(typing) === value ? typing : writtenAmount(value);
  return (
    <TextField
      label={label}
      value={shown}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
        const typed = typedAmount(event.target.value);
        setTyping(typed);
        onChange(cleanAmount(typed));
      }}
      onBlur={() => {
        setTyping(null);
        onBlur?.();
      }}
      onKeyDown={onKeyDown}
      inputRef={inputRef}
      autoFocus={autoFocus}
      placeholder="0.00"
      error={error}
      helperText={helperText}
      disabled={disabled}
      fullWidth
      type="text"
      sx={sx}
      slotProps={{
        input: {
          startAdornment: <InputAdornment position="start">{currencySymbol()}</InputAdornment>,
        },
        htmlInput: {
          inputMode: 'decimal',
        },
      }}
    />
  );
}
