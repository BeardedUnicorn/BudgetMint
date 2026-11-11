/**
 * How amounts and weeks are written: the currency (only its sign and
 * format: core converts nothing) and the day weeks start on.
 */

import { MenuItem, Stack, TextField } from '@mui/material';
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

export function RegionSettings() {
  const [settings, save] = useSettings();
  const codes = CURRENCIES.includes(settings.currency) ? CURRENCIES : [settings.currency, ...CURRENCIES];
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2, maxWidth: 520 }}>
      <TextField
        select
        label="Currency"
        value={settings.currency}
        onChange={event => save(current => ({ ...current, currency: event.target.value }))}
        helperText="How amounts are written. Nothing is converted."
        sx={{ flex: 1, minWidth: 0 }}
      >
        {codes.map(code => (
          <MenuItem key={code} value={code}>
            {currencyName(code)}
          </MenuItem>
        ))}
      </TextField>
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
