/**
 * Which bank account something is in: shown only when there's more than
 * the main one in use, so a budget with one account never sees it.
 */

import { MenuItem, TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import { useAccounts } from '../../data/BudgetContext';

export function AccountField({
  label,
  value,
  onChange,
  exclude,
  error = false,
  helperText,
  inputRef,
  size,
  sx,
}: {
  label: string;
  /** The account's id. */
  value: string;
  onChange: (accountId: string) => void;
  /** An account it can't be (where a transfer comes from, for where it goes). */
  exclude?: string;
  error?: boolean;
  helperText?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  size?: 'small';
  sx?: SxProps<Theme>;
}) {
  const { live, several } = useAccounts();
  if (!several) return null;
  return (
    <TextField
      select
      label={label}
      value={value}
      onChange={event => onChange(event.target.value)}
      error={error}
      helperText={helperText}
      inputRef={inputRef}
      size={size}
      sx={sx}
    >
      {live
        .filter(account => account.id !== exclude)
        .map(account => (
          <MenuItem key={account.id} value={account.id}>
            {account.name}
          </MenuItem>
        ))}
    </TextField>
  );
}
