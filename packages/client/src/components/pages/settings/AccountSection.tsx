/**
 * The BudgetMint account: who's signed in, signing out (of TaskMint too),
 * and deleting BudgetMint's data or the account. TaskMint's account is
 * TaskMint's: deleting this one only signs out of it.
 */

import { useState } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { AccountCircle as AccountIcon } from '@mui/icons-material';
import { useBudget } from '../../../data/BudgetContext';
import { ConfirmDialog } from '../../ui/dialogs/ConfirmDialog';
import { SettingsSection } from './SettingsSection';

export function AccountSection() {
  const { session, view } = useBudget();
  const [confirming, setConfirming] = useState<'data' | 'account' | 'signOut' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const attempt = (action: () => Promise<void>) => async () => {
    setProblem(null);
    try {
      await action();
    } catch (error) {
      // Said here, where it stays after the dialog closes
      setProblem((error as Error).message);
    }
  };

  return (
    <SettingsSection title="Account" icon={<AccountIcon />}>
      <Typography variant="body2" sx={{ mb: 2 }}>
        Signed in as <strong>{view.user?.email ?? 'you'}</strong>
        {view.user?.providers.includes('google.com') ? ' with Google' : ''}.
      </Typography>
      {problem && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {problem}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        {/* Changes not yet in the cloud: asked first */}
        <Button
          variant="outlined"
          onClick={view.saving ? () => setConfirming('signOut') : attempt(() => session.signOut())}
        >
          Sign out
        </Button>
        <Button color="error" onClick={() => setConfirming('data')}>
          Delete BudgetMint data
        </Button>
        <Button color="error" onClick={() => setConfirming('account')}>
          Delete account
        </Button>
      </Stack>
      <ConfirmDialog
        open={confirming === 'signOut'}
        onClose={() => setConfirming(null)}
        onConfirm={attempt(() => session.signOut())}
        title="Sign out before your changes are saved?"
        message="Some changes haven’t reached the cloud yet. Wait until they have (the footer stops saying Saving), or sign out anyway."
        confirmLabel="Sign out anyway"
      />
      <ConfirmDialog
        open={confirming === 'data'}
        onClose={() => setConfirming(null)}
        onConfirm={attempt(() => session.deleteData())}
        title="Delete your BudgetMint data?"
        message="Your bills, income, balance and settings are deleted from every device. TaskMint keeps its data. This can't be undone."
        confirmLabel="Delete data"
        severity="error"
      />
      <ConfirmDialog
        open={confirming === 'account'}
        onClose={() => setConfirming(null)}
        onConfirm={attempt(() => session.deleteAccount())}
        title="Delete your account?"
        message="Your BudgetMint account and its data are deleted, on every device. Your TaskMint account isn't touched. This can't be undone."
        confirmLabel="Delete account"
        severity="error"
      />
    </SettingsSection>
  );
}
