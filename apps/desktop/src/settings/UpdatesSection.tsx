// Adapted from BudgetMint apps/desktop/src/settings/UpdatesSection.tsx @ 1623bee.
import { Alert, Box, Button, FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import { SettingsSection } from '@budgetmint/client/ui';
import { updates, useUpdates, type UpdateState } from '../updates';

/** What the last check found, under the button. */
function Status({ update }: { update: UpdateState }) {
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
          <Typography>BudgetMint {update.update.version} is available.</Typography>
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
  const { update, autoCheck } = useUpdates();
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
        <Box>
          <Button variant="outlined" onClick={() => void updates.check({ manual: true })} disabled={busy}>
            Check for updates
          </Button>
        </Box>
        <Status update={update} />
      </Stack>
    </SettingsSection>
  );
}
