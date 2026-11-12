/**
 * Whether TaskMint shows. BudgetMint is a bill tracker on its own: TaskMint's
 * withdrawals, its settings and the words about it appear once a TaskMint
 * account is signed in alongside, and stay (this account, on this device)
 * if that sign-in lapses, so Settings can say to sign in again. Signing out
 * of TaskMint in Settings forgets it.
 */

import { useCallback, useEffect } from 'react';
import { useBudget } from '../data/BudgetContext';
import { useLocalStorage } from './useLocalStorage';

export const taskmintSeenKey = (uid: string) => `taskmintSeen.${uid}`;

export function useTaskMint(): { shown: boolean; forget: () => void } {
  const { view } = useBudget();
  const connected = view.taskmintUser !== null;
  // Pages (and onboarding) show only once someone is signed in
  const [seen, setSeen] = useLocalStorage(taskmintSeenKey(view.user!.uid), false);
  useEffect(() => {
    if (connected && !seen) setSeen(true);
  }, [connected, seen, setSeen]);
  const forget = useCallback(() => setSeen(false), [setSeen]);
  return { shown: connected || seen, forget };
}
