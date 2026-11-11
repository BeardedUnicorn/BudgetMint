import { useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import BugReportIcon from '@mui/icons-material/BugReport';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { SettingsSection } from '@budgetmint/client/ui';
import { command } from '../tauriShell';
import { sentence } from '../updates';

/** The log, for a bug report: what the app did and what went wrong, the window's errors among it. */
export function TroubleshootingSection() {
  const [error, setError] = useState<string | null>(null);

  const openLogs = () => {
    setError(null);
    command<void>('open_logs_folder').catch(reason => setError(sentence(reason)));
  };

  return (
    <SettingsSection title="Troubleshooting" icon={<BugReportIcon color="primary" />}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          BudgetMint keeps a log of what it does and what goes wrong. If you report a problem, attach the newest log
          file.
        </Typography>
        <Box>
          <Button variant="outlined" startIcon={<FolderOpenIcon />} onClick={openLogs}>
            Open logs folder
          </Button>
        </Box>
        {error && <Alert severity="error">Couldn't open the logs folder. {error}</Alert>}
      </Stack>
    </SettingsSection>
  );
}
