/**
 * Something that happens once, recorded in a moment: what was spent or came
 * in, how much, and when (today unless said otherwise; a day ahead is still
 * to come). Core's record makes it a one-off bill or income, already paid
 * when its day has come, with one Undo; once done, it leaves the Bills and
 * Income lists for their Finished part, and still counts in Reports.
 */

import { useRef, useState } from 'react';
import { Alert, Autocomplete, Stack, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material';
import type { ItemKind } from '@budgetmint/contracts';
import { LIMITS } from '@budgetmint/contracts';
import type { CoreRefusal } from '../../core';
import { useBudgetChange, useCoreQuery } from '../../data/BudgetContext';
import { useDirty } from '../../hooks/useDirty';
import { parseDollars } from '../../utils/money';
import { categoriesOf } from '../pages/items/ItemFilters';
import { FormDialog } from '../ui/dialogs/FormDialog';
import { CurrencyInput } from '../ui/forms/CurrencyInput';

type Wrong = 'amount' | 'name' | 'on' | 'category';

export function RecordDialog({ today, onClose }: { today: string; onClose: () => void }) {
  const change = useBudgetChange();
  const categories = categoriesOf(useCoreQuery('get_items'));
  const [kind, setKind] = useState<ItemKind>('bill');
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [on, setOn] = useState(today);
  const [category, setCategory] = useState('');
  const [wrong, setWrong] = useState<{ field: Wrong; message: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = useDirty([kind, amount, name, on, category]);
  const inputs: Record<Wrong, React.RefObject<HTMLInputElement | null>> = {
    amount: useRef<HTMLInputElement>(null),
    name: useRef<HTMLInputElement>(null),
    on: useRef<HTMLInputElement>(null),
    category: useRef<HTMLInputElement>(null),
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
          },
        },
        `${name.trim()} recorded`
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
          label={kind === 'bill' ? 'On what' : 'From what'}
          value={name}
          onChange={event => setName(event.target.value)}
          inputRef={inputs.name}
          error={wrong?.field === 'name'}
          helperText={wrongAt('name') ?? (kind === 'bill' ? 'A car repair, a gift' : 'A side job, a refund')}
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
