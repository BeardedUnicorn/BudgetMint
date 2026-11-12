/**
 * Reminders: whether this device shows them, when in the day they come,
 * how far ahead a new bill reminds, and the low-balance warning. In a
 * browser that hasn't allowed notifications, a line says so and asks. On the
 * desktop, also whether BudgetMint opens at login, so they come without
 * opening it.
 */

import { useEffect, useState } from 'react';
import { Alert, Button, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import { NotificationsActive as RemindersIcon } from '@mui/icons-material';
import { useSettings } from '../../../hooks/useSettingsChange';
import { useLocalStorage } from '../../../hooks/useLocalStorage';
import { askFailed, REMINDERS_ON_KEY } from '../../../hooks/useReminders';
import { getShell } from '../../../shell';
import type { Platform } from '../../../shell/types';
import { formattingLocale } from '../../../utils/locale';
import { leadChoices, leadLabel } from '../../budget/ItemDialog';
import { SettingsSection } from './SettingsSection';

const hourName = (hour: number) =>
  new Intl.DateTimeFormat(formattingLocale(), { hour: 'numeric' }).format(new Date(2026, 10, 2, hour));

/** Opening at login, in the tray (the desktop's): read from the system, changed there. */
function OpenAtLogin({ autostart }: { autostart: NonNullable<Platform['autostart']> }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    autostart
      .isEnabled()
      .then(setEnabled, error => setProblem(`Can’t tell whether BudgetMint opens at login. ${error}`));
  }, [autostart]);

  const toggle = async (next: boolean) => {
    setProblem(null);
    try {
      await autostart.setEnabled(next);
      setEnabled(next);
    } catch (error) {
      setProblem(`Couldn’t change opening at login. ${error}`);
    }
  };

  return (
    <>
      <FormControlLabel
        control={
          <Switch
            checked={enabled ?? false}
            disabled={enabled === null}
            onChange={event => void toggle(event.target.checked)}
          />
        }
        label="Open BudgetMint at login"
      />
      <Typography variant="body2" color="text.secondary">
        It starts in the tray, so reminders come without opening it.
      </Typography>
      {problem && <Alert severity="error">{problem}</Alert>}
    </>
  );
}

export function RemindersSection() {
  const [settings, save] = useSettings();
  const [on, setOn] = useLocalStorage(REMINDERS_ON_KEY, true);
  const [denied, setDenied] = useState(false);
  const { notifications, autostart, tray } = getShell().platform;
  const reminders = settings.reminders;
  /** Whether the browser has allowed notifications (not known yet, or not a browser: null). */
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    notifications.granted?.().then(setAllowed, askFailed);
  }, [notifications]);
  const allow = async () => {
    setDenied(false);
    const granted = await notifications.request();
    setAllowed(granted);
    setDenied(!granted);
  };
  const setReminders = (patch: Partial<typeof reminders>) =>
    save(current => ({ ...current, reminders: { ...current.reminders, ...patch } }));

  /** A test was sent (or couldn't be): what to do if it didn't show. */
  const [tested, setTested] = useState<'sent' | 'failed' | null>(null);
  const test = () =>
    notifications
      .show('BudgetMint reminders', 'This is how a reminder looks.')
      .then(() => setTested('sent'))
      .catch(() => setTested('failed'));

  const toggle = async (next: boolean) => {
    setDenied(false);
    if (next && !(await notifications.request())) {
      setDenied(true);
      return;
    }
    // Asked and allowed just now: the line below has nothing left to ask
    if (next) setAllowed(true);
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
        {on && allowed === false && (
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
            <Typography variant="body2" color="text.secondary">
              This browser hasn’t allowed BudgetMint’s notifications.
            </Typography>
            <Button variant="outlined" size="small" onClick={() => void allow()}>
              Allow
            </Button>
          </Stack>
        )}
        <Typography variant="body2" color="text.secondary">
          {notifications.firesWhenClosed
            ? 'They come even while BudgetMint is closed.'
            : tray
              ? 'They come while BudgetMint is open (or in the tray).'
              : 'They come while BudgetMint is open in a tab.'}
        </Typography>
        {/* The app can't always tell that the system is hiding its notifications: a test shows it */}
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Button variant="outlined" size="small" onClick={() => void test()}>
            Send a test reminder
          </Button>
          {tested && (
            <Typography variant="body2" color="text.secondary" role="status">
              {tested === 'sent'
                ? 'Sent. If nothing appeared, allow BudgetMint’s notifications in the system’s settings.'
                : 'It couldn’t be sent. Allow BudgetMint’s notifications in the system’s settings.'}
            </Typography>
          )}
        </Stack>
        {autostart && <OpenAtLogin autostart={autostart} />}
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
            {leadChoices(reminders.leadDays).map(days => (
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
          label="Warn me before the balance gets low"
        />
      </Stack>
    </SettingsSection>
  );
}
