/**
 * How amounts and weeks are written: the currency (only its sign and
 * format: core converts nothing) and the day weeks start on.
 */

import { MenuItem, Stack, TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import { useSettings } from '../../../hooks/useSettingsChange';
import { formattingLocale } from '../../../utils/locale';

/** The usual ones; one set elsewhere is listed too. */
const CURRENCIES = [
  'USD',
  'CAD',
  'EUR',
  'GBP',
  'AUD',
  'NZD',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'JPY',
  'INR',
  'MXN',
  'BRL',
  'ZAR',
];

/** "Euro (EUR)" in the formatting locale. */
const currencyName = (code: string) =>
  `${new Intl.DisplayNames(formattingLocale(), { type: 'currency' }).of(code)} (${code})`;

/** "US dollars", "euros": the currency as a sentence names amounts in it. */
export const currencyPlural = (code: string) =>
  new Intl.NumberFormat(formattingLocale(), { style: 'currency', currency: code, currencyDisplay: 'name' })
    .formatToParts(2)
    .find(part => part.type === 'currency')!.value;

/** The currency amounts are written in, picked from the usual ones (onboarding offers the same). */
export function CurrencyField({
  value,
  onChange,
  defaultOpen,
  sx,
}: {
  value: string;
  onChange: (code: string) => void;
  /** Its list is open as it appears. */
  defaultOpen?: boolean;
  sx?: SxProps<Theme>;
}) {
  const codes = CURRENCIES.includes(value) ? CURRENCIES : [value, ...CURRENCIES];
  return (
    <TextField
      select
      label="Currency"
      value={value}
      onChange={event => onChange(event.target.value)}
      helperText="How amounts are written. Nothing is converted."
      sx={sx}
      slotProps={{ select: { defaultOpen } }}
    >
      {codes.map(code => (
        <MenuItem key={code} value={code}>
          {currencyName(code)}
        </MenuItem>
      ))}
    </TextField>
  );
}

export function RegionSettings() {
  const [settings, save] = useSettings();
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2, maxWidth: 520 }}>
      <CurrencyField
        value={settings.currency}
        onChange={currency => save(current => ({ ...current, currency }))}
        sx={{ flex: 1, minWidth: 0 }}
      />
      <TextField
        select
        label="Weeks start on"
        value={settings.weekStartsMonday ? 'monday' : 'sunday'}
        onChange={event => save(current => ({ ...current, weekStartsMonday: event.target.value === 'monday' }))}
        sx={{ flex: 1, minWidth: 0 }}
      >
        <MenuItem value="sunday">Sunday</MenuItem>
        <MenuItem value="monday">Monday</MenuItem>
      </TextField>
    </Stack>
  );
}
