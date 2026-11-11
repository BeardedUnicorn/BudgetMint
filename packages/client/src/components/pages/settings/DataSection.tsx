/**
 * The budget as files of the user's own: a backup that restores it, a
 * spreadsheet of a year's bills and income, and restoring from a backup
 * (it replaces the budget, with Undo). Core writes and reads the files
 * (export_budget, restore_budget); the shell saves them.
 */

import { type ChangeEvent, useRef, useState } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { SaveAlt as DataIcon } from '@mui/icons-material';
import { useBudget, useBudgetChange } from '../../../data/BudgetContext';
import { getShell } from '../../../shell';
import { canSaveFiles, saveFile } from '../../../utils/saveFile';
import { ConfirmDialog } from '../../ui/dialogs/ConfirmDialog';
import { SettingsSection } from './SettingsSection';

export function DataSection() {
  const { core } = useBudget();
  const change = useBudgetChange();
  const shell = getShell();
  const picker = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async (kind: 'backup' | 'csv') => {
    setProblem(null);
    const files = core.call('export_budget');
    try {
      if (kind === 'backup') await saveFile(shell, `${files.fileStem}.json`, files.backup, 'application/json');
      else await saveFile(shell, `${files.fileStem}.csv`, files.csv, 'text/csv');
    } catch (error) {
      setProblem(`It wasn’t saved: ${(error as Error).message}`);
    }
  };

  const picked = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // The same file can be picked again
    event.target.value = '';
    if (!file) return;
    setProblem(null);
    setRestoring(await file.text());
  };

  const restore = () => {
    try {
      change('restore_budget', { backup: restoring! }, 'Budget restored from the backup');
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  return (
    <SettingsSection title="Your data" icon={<DataIcon />}>
      <Typography variant="body2" sx={{ mb: 2 }}>
        Keep a copy of your own: a backup BudgetMint can restore (your settings, every bill and income, and what you
        marked over the last year or so), or a spreadsheet of a year’s bills and income.
      </Typography>
      {problem && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {problem}
        </Alert>
      )}
      {!canSaveFiles(shell) && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This app can’t save files yet: download them from BudgetMint in a browser, signed in with this account.
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        {canSaveFiles(shell) && (
          <>
            <Button variant="outlined" onClick={() => void save('backup')}>
              Download backup
            </Button>
            <Button variant="outlined" onClick={() => void save('csv')}>
              Download spreadsheet
            </Button>
          </>
        )}
        <Button onClick={() => picker.current?.click()}>Restore from a backup…</Button>
      </Stack>
      <input
        ref={picker}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Backup file"
        onChange={event => void picked(event)}
      />
      <ConfirmDialog
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        onConfirm={restore}
        title="Replace your budget with the backup?"
        message="Everything BudgetMint has now (bills, income, what you marked, settings) is replaced on every device by what the backup holds. Undo brings it back for a few seconds."
        confirmLabel="Restore"
        severity="error"
      />
    </SettingsSection>
  );
}
