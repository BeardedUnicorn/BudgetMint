/**
 * Bank accounts: the main one every budget has, and any others (savings, a
 * second checking account), each with its own balance and low mark. With
 * only the main one there's just the way to add another. An account is
 * archived once nothing live is in it, and deleted only when nothing ever
 * was (core refuses otherwise, and says why).
 */

import { useRef, useState } from 'react';
import { Alert, Box, Button, Chip, List, ListItem, Stack, TextField, Typography } from '@mui/material';
import { AccountBalance as BankIcon, Add as AddIcon } from '@mui/icons-material';
import type { AccountView } from '@budgetmint/contracts';
import { LIMITS } from '@budgetmint/contracts';
import type { CoreRefusal } from '../../../core';
import { useNotification } from '../../../contexts/NotificationContext';
import { useAccounts, useBudgetChange, useCoreQuery } from '../../../data/BudgetContext';
import { useDirty } from '../../../hooks/useDirty';
import { formatDay } from '../../../utils/dates';
import { centsToInput, formatCents, parseDollars } from '../../../utils/money';
import { BalanceDialog } from '../../budget/BalanceDialog';
import { ConfirmDialog } from '../../ui/dialogs/ConfirmDialog';
import { FormDialog } from '../../ui/dialogs/FormDialog';
import { CurrencyInput } from '../../ui/forms/CurrencyInput';
import { SettingsSection } from './SettingsSection';

/** An account's name and low mark: a new one, or one there. */
function AccountDialog({
  account,
  onSaved,
  onClose,
}: {
  account: AccountView | null;
  /** Saved, under this id. */
  onSaved: (id: string, added: boolean) => void;
  onClose: () => void;
}) {
  const change = useBudgetChange();
  const [name, setName] = useState(account?.name ?? '');
  const [low, setLow] = useState(centsToInput(account?.lowBalanceCents || null));
  const [wrong, setWrong] = useState<{ field: 'name' | 'low'; message: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = useDirty([name, low]);
  const inputs = { name: useRef<HTMLInputElement>(null), low: useRef<HTMLInputElement>(null) };
  const refuse = (field: 'name' | 'low', message: string) => {
    setProblem(null);
    setWrong({ field, message });
    inputs[field].current?.focus();
  };
  const wrongAt = (field: 'name' | 'low') => (wrong?.field === field ? wrong.message : undefined);

  const submit = () => {
    // Left empty: no mark
    const lowBalanceCents = low === '' ? 0 : parseDollars(low);
    if (lowBalanceCents === null) {
      refuse('low', 'Enter an amount, or leave it empty for none');
      return;
    }
    const id = account?.id ?? crypto.randomUUID();
    try {
      change(
        'save_account',
        { account: { id, name, lowBalanceCents } },
        `${name.trim()} ${account ? 'saved' : 'added'}`
      );
    } catch (error) {
      if ((error as CoreRefusal).field === 'name') refuse('name', (error as Error).message);
      else setProblem((error as Error).message);
      return;
    }
    onSaved(id, account === null);
  };

  return (
    <FormDialog
      onClose={onClose}
      dirty={dirty}
      title={account ? `Edit ${account.name}` : 'Add a bank account'}
      onSubmit={submit}
    >
      <Stack spacing={2}>
        {problem && <Alert severity="error">{problem}</Alert>}
        <TextField
          label="Name"
          value={name}
          onChange={event => setName(event.target.value)}
          autoFocus
          inputRef={inputs.name}
          error={wrong?.field === 'name'}
          helperText={wrongAt('name') ?? 'Savings, Joint checking'}
          slotProps={{ htmlInput: { maxLength: LIMITS.MAX_NAME } }}
        />
        <CurrencyInput
          label="Low balance mark (optional)"
          value={low}
          onChange={setLow}
          inputRef={inputs.low}
          error={wrong?.field === 'low'}
          helperText={wrongAt('low') ?? 'Days this account ends below it are marked Low.'}
        />
      </Stack>
    </FormDialog>
  );
}

type Open = { type: 'edit'; id: string | null } | { type: 'balance' | 'delete'; id: string };

export function BankAccountsSection() {
  const { all } = useAccounts();
  const { today } = useCoreQuery('get_overview');
  const change = useBudgetChange();
  const { showError } = useNotification();
  const [open, setOpen] = useState<Open | null>(null);
  // One that's gone (deleted on another device) takes its dialog with it
  const account = all.find(one => one.id === open?.id) ?? null;
  /** A change core may refuse: why, in a toast. */
  const attempt = (run: () => void) => {
    try {
      run();
    } catch (error) {
      showError((error as Error).message);
    }
  };

  return (
    <SettingsSection title="Bank accounts" icon={<BankIcon />}>
      <Stack spacing={2} sx={{ maxWidth: 620 }}>
        {all.length === 1 ? (
          <Typography variant="body2" color="text.secondary">
            BudgetMint forecasts one bank account. If you have more (savings, a second checking account), add them: each
            gets its own balance and forecast.
          </Typography>
        ) : (
          <List disablePadding aria-label="Bank accounts">
            {all.map(one => (
              <ListItem
                key={one.id}
                disableGutters
                sx={{ flexWrap: 'wrap', gap: 1, justifyContent: 'space-between', opacity: one.archived ? 0.7 : 1 }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                      {one.name}
                    </Typography>
                    {one.main && <Chip size="small" label="Main" variant="outlined" />}
                    {one.archived && <Chip size="small" label="Archived" />}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {one.balance
                      ? `${formatCents(one.balance.cents)} at the end of ${formatDay(one.balance.asOf)}`
                      : 'No balance yet'}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                  {one.archived ? (
                    <Button
                      size="small"
                      aria-label={`Bring back ${one.name}`}
                      onClick={() =>
                        attempt(() =>
                          change('archive_account', { accountId: one.id, archived: false }, `${one.name} brought back`)
                        )
                      }
                    >
                      Bring back
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="small"
                        aria-label={`${one.balance ? 'Update' : 'Set'} the ${one.name} balance`}
                        onClick={() => setOpen({ type: 'balance', id: one.id })}
                      >
                        {one.balance ? 'Update balance' : 'Set balance'}
                      </Button>
                      <Button
                        size="small"
                        aria-label={`Edit ${one.name}`}
                        onClick={() => setOpen({ type: 'edit', id: one.id })}
                      >
                        Edit
                      </Button>
                    </>
                  )}
                  {!one.main && !one.archived && (
                    <Button
                      size="small"
                      aria-label={`Archive ${one.name}`}
                      onClick={() =>
                        attempt(() =>
                          change('archive_account', { accountId: one.id, archived: true }, `${one.name} archived`)
                        )
                      }
                    >
                      Archive
                    </Button>
                  )}
                  {!one.main && one.items === 0 && (
                    <Button
                      size="small"
                      color="error"
                      aria-label={`Delete ${one.name}`}
                      onClick={() => setOpen({ type: 'delete', id: one.id })}
                    >
                      Delete
                    </Button>
                  )}
                </Stack>
              </ListItem>
            ))}
          </List>
        )}
        <Box>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setOpen({ type: 'edit', id: null })}>
            Add a bank account
          </Button>
        </Box>
      </Stack>
      {open?.type === 'edit' && (open.id === null || account) && (
        <AccountDialog
          account={account}
          // A new one has no balance yet, and is out of the total until it does: asked for next
          onSaved={(id, added) => setOpen(added ? { type: 'balance', id } : null)}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.type === 'balance' && account && (
        <BalanceDialog accountId={account.id} today={today} onClose={() => setOpen(null)} />
      )}
      <ConfirmDialog
        open={open?.type === 'delete' && account !== null}
        onClose={() => setOpen(null)}
        onConfirm={() =>
          attempt(() => change('delete_account', { accountId: account!.id }, `${account!.name} deleted`))
        }
        title={`Delete ${account?.name ?? ''}?`}
        message="Nothing is in it. Undo brings it back for a few seconds; after that it’s gone."
        confirmLabel="Delete"
        severity="error"
      />
    </SettingsSection>
  );
}
