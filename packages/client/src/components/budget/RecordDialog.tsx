/**
 * Something that happens once, recorded in a moment: what was spent or came
 * in, how much, and when (today unless said otherwise; a day ahead is still
 * to come). Core's record makes it a one-off bill or income, already paid
 * when its day has come, with one Undo; once done, it leaves the Bills and
 * Income lists for their Finished part, and still counts in Reports. With
 * more than one bank account, money moved from one to another is recorded
 * here too.
 */

import { useRef, useState } from 'react';
import { Alert, Autocomplete, Stack, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material';
import type { ItemKind } from '@budgetmint/contracts';
import { LIMITS, MAIN_ACCOUNT } from '@budgetmint/contracts';
import type { CoreRefusal } from '../../core';
import { otherAccount, useAccounts, useBudgetChange, useCoreQuery } from '../../data/BudgetContext';
import { useDirty } from '../../hooks/useDirty';
import { parseDollars } from '../../utils/money';
import { categoriesOf } from '../pages/items/ItemFilters';
import { FormDialog } from '../ui/dialogs/FormDialog';
import { CurrencyInput } from '../ui/forms/CurrencyInput';
import { AccountField } from './AccountField';
import { FromBalanceField, savedSaying, useFromBalance } from './FromBalance';

type Wrong = 'amount' | 'name' | 'on' | 'category' | 'account';

/** What's asked of each kind. */
const WORDS: Record<ItemKind, { name: string; such: string; account: string }> = {
  bill: { name: 'On what', such: 'A car repair, a gift', account: 'From' },
  income: { name: 'From what', such: 'A side job, a refund', account: 'Into' },
  transfer: { name: 'What for', such: 'Savings, a card payment', account: 'From' },
};

export function RecordDialog({
  today,
  kind: opened = 'bill',
  onClose,
}: {
  today: string;
  /** What it opens to record (something spent, unless given). */
  kind?: ItemKind;
  onClose: () => void;
}) {
  const change = useBudgetChange();
  const categories = categoriesOf(useCoreQuery('get_items'));
  const { live, several } = useAccounts();
  const [kind, setKind] = useState<ItemKind>(opened);
  /** Where money moved goes, as chosen. */
  const [wanted, setWanted] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [on, setOn] = useState(today);
  const [category, setCategory] = useState('');
  const [accountId, setAccountId] = useState<string>(MAIN_ACCOUNT);
  const [wrong, setWrong] = useState<{ field: Wrong; message: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Dated today or before, it's paid: by the balance's day, it may move the balance
  // Another account than it comes from
  const toAccountId = otherAccount(live, accountId, wanted);
  const fromBalance = useFromBalance(on <= today ? on : null, { kind, accountId, toAccountId });
  const dirty = useDirty([kind, amount, name, on, category, accountId, wanted, fromBalance.checked]);
  const inputs: Record<Wrong, React.RefObject<HTMLInputElement | null>> = {
    amount: useRef<HTMLInputElement>(null),
    name: useRef<HTMLInputElement>(null),
    on: useRef<HTMLInputElement>(null),
    category: useRef<HTMLInputElement>(null),
    account: useRef<HTMLInputElement>(null),
  };
  const refuse = (field: Wrong, message: string) => {
    setProblem(null);
    setWrong({ field, message });
    inputs[field].current?.focus();
  };
  const wrongAt = (field: Wrong) => (wrong?.field === field ? wrong.message : undefined);

  const submit = () => {
    const cents = parseDollars(amount);
    if (cents === null || cents === 0) {
      refuse('amount', 'Enter the amount');
      return;
    }
    try {
      change(
        'record',
        {
          record: {
            id: crypto.randomUUID(),
            kind,
            name,
            amountCents: cents,
            on,
            category: category || null,
            note: null,
            accountId,
            toAccountId: toAccountId ?? undefined,
          },
          fromBalance: fromBalance.checked,
        },
        savedSaying(`${name.trim()} recorded`, kind, fromBalance.checked)
      );
    } catch (error) {
      // Said under its field, when it's about one (a start date is when it was)
      const field = (error as CoreRefusal).field;
      if (field) refuse(field === 'dates' ? 'on' : (field as Wrong), (error as Error).message);
      else setProblem((error as Error).message);
      return;
    }
    onClose();
  };

  return (
    <FormDialog onClose={onClose} dirty={dirty} title="Record a one-off" onSubmit={submit}>
      <Stack spacing={2}>
        {problem && <Alert severity="error">{problem}</Alert>}
        <ToggleButtonGroup
          exclusive
          fullWidth
          value={kind}
          onChange={(_event, next: ItemKind | null) => next && setKind(next)}
          aria-label="Money out or in"
        >
          <ToggleButton value="bill">I spent</ToggleButton>
          <ToggleButton value="income">I got</ToggleButton>
          {several && <ToggleButton value="transfer">I moved</ToggleButton>}
        </ToggleButtonGroup>
        <CurrencyInput
          label="Amount"
          value={amount}
          onChange={setAmount}
          error={wrong?.field === 'amount'}
          helperText={wrongAt('amount')}
          inputRef={inputs.amount}
          autoFocus
        />
        <TextField
          label={WORDS[kind].name}
          value={name}
          onChange={event => setName(event.target.value)}
          inputRef={inputs.name}
          error={wrong?.field === 'name'}
          helperText={wrongAt('name') ?? WORDS[kind].such}
          slotProps={{ htmlInput: { maxLength: LIMITS.MAX_NAME } }}
        />
        <TextField
          label="When"
          type="date"
          value={on}
          onChange={event => setOn(event.target.value)}
          inputRef={inputs.on}
          error={wrong?.field === 'on'}
          helperText={wrongAt('on') ?? (on > today ? 'Still to come: it counts in the forecast' : undefined)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <AccountField
          label={WORDS[kind].account}
          value={accountId}
          onChange={setAccountId}
          inputRef={inputs.account}
          error={wrong?.field === 'account'}
          helperText={wrongAt('account')}
        />
        {kind === 'transfer' && toAccountId && (
          <AccountField label="To" value={toAccountId} onChange={setWanted} exclude={accountId} />
        )}
        <FromBalanceField kind={kind} amountCents={parseDollars(amount)} on={on} state={fromBalance} />
        <Autocomplete
          freeSolo
          options={categories}
          inputValue={category}
          onInputChange={(_event, value) => setCategory(value)}
          renderInput={params => (
            <TextField
              {...params}
              inputRef={inputs.category}
              error={wrong?.field === 'category'}
              helperText={wrongAt('category')}
              label="Category (optional)"
              slotProps={{
                ...params.slotProps,
                htmlInput: { ...params.slotProps.htmlInput, maxLength: LIMITS.MAX_CATEGORY },
              }}
            />
          )}
        />
      </Stack>
    </FormDialog>
  );
}
