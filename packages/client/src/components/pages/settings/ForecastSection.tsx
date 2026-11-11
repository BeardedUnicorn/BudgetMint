/**
 * The forecast: the balance it starts from, how far ahead it looks, and the
 * mark below which a day counts as low.
 */

import { useState } from 'react';
import { Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { ShowChart as ForecastIcon } from '@mui/icons-material';
import { LIMITS } from '@budgetmint/contracts';
import { useCoreQuery } from '../../../data/BudgetContext';
import { useSettings } from '../../../hooks/useSettingsChange';
import { formatDay } from '../../../utils/dates';
import { formatCents } from '../../../utils/money';
import { BalanceDialog } from '../../budget/BalanceDialog';
import { AmountSetting } from './AmountSetting';
import { SettingsSection } from './SettingsSection';

const HORIZONS = [30, 60, 90, 180, 365].filter(
  days => days >= LIMITS.MIN_HORIZON_DAYS && days <= LIMITS.MAX_HORIZON_DAYS
);

export function ForecastSection() {
  const [settings, save] = useSettings();
  const { today } = useCoreQuery('get_overview');
  const [editing, setEditing] = useState(false);
  const { balance } = settings;

  return (
    <SettingsSection title="Forecast" icon={<ForecastIcon />}>
      <Stack spacing={2} sx={{ maxWidth: 520 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" sx={{ flex: 1 }}>
            {balance
              ? `Starts from ${formatCents(balance.cents)}, your balance at the end of ${formatDay(balance.asOf)}.`
              : 'Starts from $0 until you set your balance.'}
          </Typography>
          <Button variant="outlined" onClick={() => setEditing(true)}>
            {balance ? 'Update balance' : 'Set balance'}
          </Button>
        </Stack>
        <TextField
          select
          label="Looks ahead"
          value={settings.horizonDays}
          onChange={event => save(current => ({ ...current, horizonDays: Number(event.target.value) }))}
          sx={{ maxWidth: 220 }}
        >
          {[...new Set([...HORIZONS, settings.horizonDays])]
            .sort((a, b) => a - b)
            .map(days => (
              <MenuItem key={days} value={days}>
                {days} days
              </MenuItem>
            ))}
        </TextField>
        <AmountSetting
          label="Low balance mark"
          cents={settings.lowBalanceCents}
          onSave={lowBalanceCents => save(current => ({ ...current, lowBalanceCents }))}
          helperText="Days that end below it are flagged (and below $0, short). Leave it empty for none."
          sx={{ maxWidth: 260 }}
        />
      </Stack>
      {editing && <BalanceDialog balance={balance} today={today} onClose={() => setEditing(false)} />}
    </SettingsSection>
  );
}
