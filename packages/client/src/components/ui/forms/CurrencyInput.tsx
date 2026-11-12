// Adapted from TaskMint packages/client/src/components/ui/forms/CurrencyInput.tsx @ 1623bee: it takes a ref to its input, and can start with the focus.
import React from 'react';
import { TextField, InputAdornment } from '@mui/material';
import { LIMITS } from '@budgetmint/contracts';
import { CurrencyInputProps } from '../../../types/ui';
import { currencySymbol } from '../../../utils/money';

/** The largest amount the field takes: core's. */
export const MAX_AMOUNT = LIMITS.MAX_CENTS / 100;

/**
 * An amount as typed, kept to what's valid: digits and one decimal point, at
 * most two decimals, at most MAX_AMOUNT. (No minus sign, so never negative.)
 */
export function cleanAmount(text: string): string {
  const typed = text.replace(/[^\d.]/g, '');
  const point = typed.indexOf('.');
  const amount =
    point === -1
      ? typed
      : typed.slice(0, point + 1) +
        typed
          .slice(point + 1)
          .replace(/\./g, '')
          .slice(0, 2);
  return parseFloat(amount) > MAX_AMOUNT ? String(MAX_AMOUNT) : amount;
}

/** An amount field, in the settings' currency. */
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
  return (
    <TextField
      label={label}
      value={value}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(cleanAmount(event.target.value))}
      onBlur={onBlur}
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
          pattern: '[0-9]*[.]?[0-9]*',
        },
      }}
    />
  );
}
