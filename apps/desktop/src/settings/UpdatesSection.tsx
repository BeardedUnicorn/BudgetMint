// Adapted from TaskMint apps/desktop/src/settings/UpdatesSection.tsx @ 1623bee.
import { Alert, Box, Button, FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import { SettingsSection } from '@budgetmint/client/ui';
import { APP_VERSION } from '../appVersion';
import { updates, useUpdates, type UpdateState } from '../updates';

/** When a check last got an answer, as "Nov 11, 2026, 9:41 AM" in the user's locale. */
export function checkedAt(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
}

/** What the last check found, under the button (here, and in About). */
export function UpdateStatus({ update, skippedVersion }: { update: UpdateState; skippedVersion: string | null }) {
  switch (update.status) {
    case 'checking':
      return <Typography color="text.secondary">Checking for updates…</Typography>;
    case 'upToDate':
      return <Typography color="text.secondary">BudgetMint is up to date.</Typography>;
    case 'checkFailed':
      return <Alert severity="error">Couldn't check for updates. {update.error}</Alert>;
    case 'available':
      return (
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Typography>
            BudgetMint {update.update.version} is available
            {update.update.version === skippedVersion ? '; you chose to skip it.' : '.'}
          </Typography>
          <Button size="small" onClick={updates.show}>
            Update…
          </Button>
        </Stack>
      );
    case 'installing':
    case 'installFailed':
      return <Typography color="text.secondary">Updating to BudgetMint {update.update.version}…</Typography>;
    default:
      return null;
  }
}

/** Checking GitHub for a new release, on its own or now. */
export function UpdatesSection() {
  const { update, autoCheck, lastCheckedAt, skippedVersion } = useUpdates();
  const busy = update.status === 'checking' || update.status === 'installing';

  return (
    <SettingsSection title="Updates" icon={<SystemUpdateAltIcon color="primary" />}>
      <Stack spacing={2}>
        <Box>
          <FormControlLabel
            control={<Switch checked={autoCheck} onChange={event => updates.setAutoCheck(event.target.checked)} />}
            label="Check for updates automatically"
          />
          <Typography variant="body2" color="text.secondary">
            BudgetMint looks for a new release on GitHub when it starts and once a day, and asks before installing it.
          </Typography>
        </Box>
        <Typography variant="body2">
          You have BudgetMint {APP_VERSION}.{' '}
          {lastCheckedAt === null ? 'Not checked yet.' : `Last checked ${checkedAt(lastCheckedAt)}.`}
        </Typography>
        <Box>
          <Button variant="outlined" onClick={() => void updates.check({ manual: true })} disabled={busy}>
            Check for updates
          </Button>
        </Box>
        <UpdateStatus update={update} skippedVersion={skippedVersion} />
      </Stack>
    </SettingsSection>
  );
}
