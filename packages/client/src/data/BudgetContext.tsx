/**
 * The account's budget for the pages: the session (sign-in, the cloud),
 * core's answers to what each page asks, and the changes they make.
 */

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { CommandArgs, CommandName, CommandReply, Planned } from '@budgetmint/contracts';
import type { CoreArgs, CoreClient } from '../core';
import type { BudgetSession, SessionView } from '../cloud/session';
import { setCurrency } from '../utils/money';
import { useNotification } from '../contexts/NotificationContext';

interface BudgetValue {
  session: BudgetSession;
  core: CoreClient;
  view: SessionView;
}

const BudgetContext = createContext<BudgetValue | null>(null);

export function BudgetProvider({
  session,
  core,
  children,
}: {
  session: BudgetSession;
  core: CoreClient;
  children: ReactNode;
}) {
  const view = useSyncExternalStore(session.subscribe, session.getView);
  // Amounts are written in the settings' currency: set before anything in here writes one
  setCurrency(core.call('get_settings').settings.currency);
  return <BudgetContext.Provider value={{ session, core, view }}>{children}</BudgetContext.Provider>;
}

export function useBudget(): BudgetValue {
  const context = useContext(BudgetContext);
  if (!context) throw new Error('useBudget must be used within a BudgetProvider');
  return context;
}

/** A number that changes every `intervalMs`, so what depends on the time (today, overdue) moves on. */
export function useTick(intervalMs = 60_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(n => n + 1), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return tick;
}

/** What core says to `command`, asked again when the data changes, and each minute. */
export function useCoreQuery<K extends CommandName>(command: K, ...args: CoreArgs<K>): CommandReply<K> {
  const { core, view } = useBudget();
  const tick = useTick();
  const key = `${command} ${JSON.stringify(args[0] ?? null)} ${view.version} ${tick}`;
  const cache = useRef<{ key: string; reply: CommandReply<K> } | null>(null);
  if (cache.current?.key !== key) cache.current = { key, reply: core.call(command, ...args) };
  return cache.current.reply;
}

/** The commands that change the budget: each returns the writes it plans. */
export type ChangeCommand =
  | 'save_item'
  | 'change_schedule'
  | 'archive_item'
  | 'delete_item'
  | 'set_occurrence'
  | 'set_balance'
  | 'save_settings'
  | 'restore_budget'
  | 'settle';

/**
 * Makes a change: core checks and plans it (a refusal throws, with the
 * message for the form), and the session writes it. With `done`, a toast
 * says so, with Undo. Whether anything changed.
 */
export function useBudgetChange() {
  const { core, session } = useBudget();
  const { showSuccess, showError } = useNotification();
  return useCallback(
    <K extends ChangeCommand>(command: K, args: CommandArgs<K>, done?: string): boolean => {
      const planned = core.call(command, ...([args] as unknown as CoreArgs<K>)) as Planned;
      if (planned.writes.length === 0) return false;
      const failed = (error: Error) => showError(error.message, { title: 'Not saved' });
      session.write(planned.writes).catch(failed);
      if (done) {
        // Core gives the undo only while the change still stands: a later one isn't taken back with it
        const undo = () => {
          try {
            session.write(core.call('undo', { planned })).catch(failed);
          } catch (error) {
            showError((error as Error).message, { title: 'Not undone' });
          }
        };
        showSuccess(done, { actions: [{ label: 'Undo', onClick: undo }] });
      }
      return true;
    },
    [core, session, showSuccess, showError]
  );
}
