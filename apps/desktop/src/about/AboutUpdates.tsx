/**
 * About BudgetMint's word on updates, on the desktop: when it last checked,
 * what it found (Settings → Updates says the same), and a check now.
 */

import { Box, Button, Stack, Typography } from '@mui/material';
import { checkedAt, UpdateStatus } from '../settings/UpdatesSection';
import { updates, useUpdates } from '../updates';

export function AboutUpdates() {
  const { update, lastCheckedAt, skippedVersion } = useUpdates();
  const busy = update.status === 'checking' || update.status === 'installing';
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="body2" color="text.secondary">
          {lastCheckedAt === null ? 'Not checked for updates yet.' : `Last checked ${checkedAt(lastCheckedAt)}.`}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          onClick={() => void updates.check({ manual: true })}
          disabled={busy}
          sx={{ flexShrink: 0 }}
        >
          Check for Updates
        </Button>
      </Stack>
      <Box sx={{ typography: 'body2' }}>
        <UpdateStatus update={update} skippedVersion={skippedVersion} />
      </Box>
    </Stack>
  );
}
