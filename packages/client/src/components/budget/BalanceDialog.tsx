/**
 * Setting the balance the forecast starts from: what the account holds,
 * as of the end of a day (today, or one before, if today's spending isn't
 * in it yet).
 */

import { useState } from 'react';
import { Alert, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import type { Balance } from '@budgetmint/contracts';
import { useBudgetChange } from '../../data/BudgetContext';
import { centsToInput, parseDollars } from '../../utils/money';
import { FormDialog } from '../ui/dialogs/FormDialog';

export function BalanceDialog({
  balance,
  today,
  onClose,
}: {
  balance: Balance | null;
  today: string;
  onClose: () => void;
}) {
  const change = useBudgetChange();
  const [amount, setAmount] = useState(centsToInput(balance?.cents ?? null));
  const [asOf, setAsOf] = useState(today);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = () => {
    const cents = parseDollars(amount);
    if (cents === null) {
      setProblem('Enter what the account holds (a minus sign if it’s overdrawn)');
      return;
    }
    try {
      change('set_balance', { balance: { cents, asOf } }, 'Balance updated');
    } catch (error) {
      setProblem((error as Error).message);
      return;
    }
    onClose();
  };

  return (
    <FormDialog onClose={onClose} title="Your balance" onSubmit={submit}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          What your account holds now. Bills and income after that day move it from there.
        </Typography>
        {problem && <Alert severity="error">{problem}</Alert>}
        <TextField
          label="Balance"
          value={amount}
          onChange={event => setAmount(event.target.value)}
          autoFocus
          slotProps={{
            input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
            htmlInput: { inputMode: 'decimal' },
          }}
        />
        <TextField
          label="As of the end of"
          type="date"
          value={asOf}
          onChange={event => setAsOf(event.target.value)}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
        />
      </Stack>
    </FormDialog>
  );
}
