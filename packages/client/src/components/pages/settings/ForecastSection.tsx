/**
 * The forecast: the balance it starts from, how far ahead it looks, the
 * mark below which a day counts as low, and the everyday spending it takes
 * out a day at a time (with what the balance's updates say it is).
 */

import { useState } from 'react';
import { Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { ShowChart as ForecastIcon } from '@mui/icons-material';
import { LIMITS } from '@budgetmint/contracts';
import { useCoreQuery } from '../../../data/BudgetContext';
import { useSettings } from '../../../hooks/useSettingsChange';
import { formatDay } from '../../../utils/dates';
import { formatCents, formatWholeCents } from '../../../utils/money';
import { BalanceDialog } from '../../budget/BalanceDialog';
import { AmountSetting } from './AmountSetting';
import { SettingsSection } from './SettingsSection';

const HORIZONS = [30, 60, 90, 180, 365].filter(
  days => days >= LIMITS.MIN_HORIZON_DAYS && days <= LIMITS.MAX_HORIZON_DAYS
);

export function ForecastSection() {
  const [settings, save] = useSettings();
  const { today } = useCoreQuery('get_overview');
  const estimate = useCoreQuery('get_spending_estimate');
  const [editing, setEditing] = useState(false);
  const { balance } = settings;

  return (
    <SettingsSection title="Forecast" icon={<ForecastIcon />}>
      <Stack spacing={2} sx={{ maxWidth: 520 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" sx={{ flex: 1 }}>
            {balance
              ? `Starts from ${formatCents(balance.cents)}, your balance at the end of ${formatDay(balance.asOf)}.`
              : `Starts from ${formatWholeCents(0)} until you set your balance.`}
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
          helperText={`Days that end below it are flagged (and below ${formatWholeCents(0)}, short). Leave it empty for none.`}
          sx={{ maxWidth: 260 }}
        />
        <AmountSetting
          label="Everyday spending, a week"
          cents={settings.spendingWeeklyCents}
          onSave={spendingWeeklyCents => save(current => ({ ...current, spendingWeeklyCents }))}
          helperText="Food, fuel and the rest besides your bills: the forecast takes a day’s share out each day. Leave it empty for none."
          sx={{ maxWidth: 260 }}
        />
        {estimate && estimate.weeklyCents !== settings.spendingWeeklyCents && (
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
              By your balance updates over the last {estimate.days} days, you spend about{' '}
              {formatCents(estimate.weeklyCents)} a week besides your bills.
            </Typography>
            <Button
              variant="outlined"
              onClick={() => save(current => ({ ...current, spendingWeeklyCents: estimate.weeklyCents }))}
            >
              Use it
            </Button>
          </Stack>
        )}
      </Stack>
      {editing && <BalanceDialog balance={balance} today={today} onClose={() => setEditing(false)} />}
    </SettingsSection>
  );
}
