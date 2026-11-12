/**
 * The BudgetMint account: who's signed in, signing out (of TaskMint too,
 * asked first: SignOutDialog), and deleting BudgetMint's data or the
 * account. TaskMint's account is TaskMint's: deleting this one only signs
 * out of it.
 */

import { useState } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { AccountCircle as AccountIcon } from '@mui/icons-material';
import { useAppDialogs } from '../../../contexts/AppDialogsContext';
import { useBudget } from '../../../data/BudgetContext';
import { ConfirmDialog } from '../../ui/dialogs/ConfirmDialog';
import { SettingsSection } from './SettingsSection';

export function AccountSection() {
  const { session, view } = useBudget();
  const dialogs = useAppDialogs();
  const [confirming, setConfirming] = useState<'data' | 'account' | null>(null);
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
      <Typography variant="body2" sx={{ mb: 1 }}>
        Signed in as <strong>{view.user?.email ?? 'you'}</strong>
        {view.user?.providers.includes('google.com') ? ' with Google' : ''}.
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Your budget is kept in this account, and stays in step on every device you sign in to it on.
      </Typography>
      {problem && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {problem}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        <Button variant="outlined" onClick={() => dialogs.open('signOut')}>
          Sign out…
        </Button>
        <Button color="error" onClick={() => setConfirming('data')}>
          Delete BudgetMint data
        </Button>
        <Button color="error" onClick={() => setConfirming('account')}>
          Delete account
        </Button>
      </Stack>
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
