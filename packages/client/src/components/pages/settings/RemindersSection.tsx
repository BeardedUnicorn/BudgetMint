/**
 * Reminders: whether this device shows them, when in the day they come,
 * how far ahead a new bill reminds, and the low-balance warning.
 */

import { useState } from 'react';
import { Alert, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import { NotificationsActive as RemindersIcon } from '@mui/icons-material';
import { useSettings } from '../../../hooks/useSettingsChange';
import { useLocalStorage } from '../../../hooks/useLocalStorage';
import { REMINDERS_ON_KEY } from '../../../hooks/useReminders';
import { getShell } from '../../../shell';
import { formattingLocale } from '../../../utils/locale';
import { LEAD_CHOICES, leadLabel } from '../../budget/ItemDialog';
import { SettingsSection } from './SettingsSection';

const hourName = (hour: number) =>
  new Intl.DateTimeFormat(formattingLocale(), { hour: 'numeric' }).format(new Date(2026, 10, 2, hour));

export function RemindersSection() {
  const [settings, save] = useSettings();
  const [on, setOn] = useLocalStorage(REMINDERS_ON_KEY, true);
  const [denied, setDenied] = useState(false);
  const { notifications } = getShell().platform;
  const reminders = settings.reminders;
  const setReminders = (patch: Partial<typeof reminders>) =>
    save(current => ({ ...current, reminders: { ...current.reminders, ...patch } }));

  const toggle = async (next: boolean) => {
    setDenied(false);
    if (next && !(await notifications.request())) {
      setDenied(true);
      return;
    }
    setOn(next);
  };

  return (
    <SettingsSection title="Reminders" icon={<RemindersIcon />}>
      <Stack spacing={2} sx={{ maxWidth: 520 }}>
        <FormControlLabel
          control={<Switch checked={on} onChange={event => void toggle(event.target.checked)} />}
          label="Remind me on this device"
        />
        {denied && (
          <Alert severity="warning">
            Notifications are turned off for BudgetMint. Allow them in the system’s settings.
          </Alert>
        )}
        <Typography variant="body2" color="text.secondary">
          {notifications.firesWhenClosed
            ? 'They come even while BudgetMint is closed.'
            : 'They come while BudgetMint is open (or in the tray).'}
        </Typography>
        <Stack direction="row" spacing={2}>
          <TextField
            select
            label="At"
            value={reminders.hour}
            onChange={event => setReminders({ hour: Number(event.target.value) })}
            sx={{ minWidth: 140 }}
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <MenuItem key={hour} value={hour}>
                {hourName(hour)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="New bills remind"
            value={reminders.leadDays}
            onChange={event => setReminders({ leadDays: Number(event.target.value) })}
            sx={{ minWidth: 200 }}
          >
            {LEAD_CHOICES.map(days => (
              <MenuItem key={days} value={days}>
                {leadLabel(days)}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        <FormControlLabel
          control={
            <Switch
              checked={reminders.lowBalance}
              onChange={event => setReminders({ lowBalance: event.target.checked })}
            />
          }
          label="Warn me before the balance goes low"
        />
      </Stack>
    </SettingsSection>
  );
}
