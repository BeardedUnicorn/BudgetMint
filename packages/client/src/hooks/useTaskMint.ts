/**
 * Whether TaskMint shows. BudgetMint is a bill tracker on its own: TaskMint's
 * withdrawals, its settings and the words about it appear once a TaskMint
 * account is signed in alongside, and stay (this account, on this device)
 * if that sign-in lapses, so Settings can say to sign in again. Signing out
 * of TaskMint in Settings forgets it, once the sign-out has gone through:
 * until then the user is still there, and would be remembered again.
 */

import { useCallback, useEffect } from 'react';
import { useBudget } from '../data/BudgetContext';
import { useLocalStorage } from './useLocalStorage';

export const taskmintSeenKey = (uid: string) => `taskmintSeen.${uid}`;

/** Seen, not, or signed out of on purpose and forgotten once that's done. */
type Seen = boolean | 'forgetting';

export function useTaskMint(): { shown: boolean; forget: () => void } {
  const { view } = useBudget();
  const connected = view.taskmintUser !== null;
  // Pages (and onboarding) show only once someone is signed in
  const [seen, setSeen] = useLocalStorage<Seen>(taskmintSeenKey(view.user!.uid), false);
  useEffect(() => {
    if (connected && seen === false) setSeen(true);
    if (!connected && seen === 'forgetting') setSeen(false);
  }, [connected, seen, setSeen]);
  /** Called as TaskMint's signed out of: forgotten once nobody's signed in to it. */
  const forget = useCallback(() => setSeen('forgetting'), [setSeen]);
  return { shown: connected || seen !== false, forget };
}
