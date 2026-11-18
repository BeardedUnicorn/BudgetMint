/**
 * Importing a bank statement from wherever it's offered (Bills, the
 * Overview's Add, Settings → Your data): a file picked, or several (a month
 * each, say: CSV or OFX), read by core as one statement, and gone through in
 * StatementDialog. Nothing of it is kept until that's saved.
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
  const [statement, setStatement] = useState<{ texts: string[]; first: StatementView } | null>(null);
  const problem = onProblem ?? showError;

  const picked = async (event: ChangeEvent<HTMLInputElement>) => {
    // (A file input always has its list of files)
    const files = [...event.target.files!];
    // The same file can be picked again
    event.target.value = '';
    if (files.length === 0) return;
    const texts = await Promise.all(files.map(file => file.text()));
    try {
      setStatement({ texts, first: core.call('read_statement', { texts }) });
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
        multiple
        hidden
        aria-label="Bank statement file"
        onChange={event => void picked(event)}
      />
      {statement && <StatementDialog {...statement} onClose={() => setStatement(null)} />}
    </>
  );
}
