/**
 * Importing a bank statement from wherever it's offered (Bills, the
 * Overview's Add, Settings → Your data): a file picked (CSV or OFX), read by
 * core, and matched in StatementDialog. The file stays on this device: only
 * what's marked is saved.
 */

import { type ChangeEvent, type ReactNode, useRef, useState } from 'react';
import type { StatementView } from '@budgetmint/contracts';
import { useNotification } from '../../contexts/NotificationContext';
import { useBudget } from '../../data/BudgetContext';
import { StatementDialog } from './StatementDialog';

export function StatementImport({
  children,
  onProblem,
}: {
  /** What opens the file picker, given the way to. */
  children: (choose: () => void) => ReactNode;
  /** Where a file that can't be read is said (a toast, unless given). */
  onProblem?: (message: string) => void;
}) {
  const { core } = useBudget();
  const { showError } = useNotification();
  const picker = useRef<HTMLInputElement>(null);
  const [statement, setStatement] = useState<{ text: string; first: StatementView } | null>(null);
  const problem = onProblem ?? showError;

  const picked = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // The same file can be picked again
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    try {
      setStatement({ text, first: core.call('read_statement', { text }) });
    } catch (error) {
      problem((error as Error).message);
    }
  };

  return (
    <>
      {children(() => picker.current?.click())}
      <input
        ref={picker}
        type="file"
        accept=".csv,.ofx,.qfx,.txt,text/csv,application/x-ofx"
        hidden
        aria-label="Bank statement file"
        onChange={event => void picked(event)}
      />
      {statement && <StatementDialog {...statement} onClose={() => setStatement(null)} />}
    </>
  );
}
