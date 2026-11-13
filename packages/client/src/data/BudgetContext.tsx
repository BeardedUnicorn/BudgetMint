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
import type {
  AccountView,
  CommandArgs,
  CommandName,
  CommandReply,
  ForecastView,
  Overview,
  Planned,
} from '@budgetmint/contracts';
import type { CoreArgs, CoreClient } from '../core';
import type { BudgetSession, SessionView } from '../cloud/session';
import { setCurrency } from '../utils/money';
import { useNotification } from '../contexts/NotificationContext';

interface BudgetValue {
  session: BudgetSession;
  core: CoreClient;
  view: SessionView;
  /** The bank account the Overview and the Forecast are of (null: all of them), as last chosen. */
  scope: string | null;
  setScope: (scope: string | null) => void;
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
  const [scope, setScope] = useState<string | null>(null);
  // Amounts are written in the settings' currency: set before anything in here writes one
  setCurrency(core.call('get_settings').settings.currency);
  return <BudgetContext.Provider value={{ session, core, view, scope, setScope }}>{children}</BudgetContext.Provider>;
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

/** The name of the account `id` among `accounts`; empty for one that isn't there (not read yet, or gone). */
export const accountName = (accounts: AccountView[], id: string) =>
  accounts.find(account => account.id === id)?.name ?? '';

/** The balance of the account `id` among `accounts`; none when it has none, or isn't there. */
export const accountBalance = (accounts: AccountView[], id: string) =>
  accounts.find(account => account.id === id)?.balance ?? null;

/**
 * The bank accounts: all of them, the ones in use, and whether there's
 * more than the main one in use (with only it, nothing names an account).
 */
export function useAccounts() {
  const all = useCoreQuery('get_accounts');
  const live = all.filter(account => !account.archived);
  return { all, live, several: live.length > 1, nameOf: (id: string) => accountName(all, id) };
}

/**
 * The account the Overview and the Forecast are of (null: every account
 * together), and the way to choose it. One that's no longer in use is all
 * of them again.
 */
export function useAccountScope(): [string | null, (scope: string | null) => void] {
  const { scope, setScope } = useBudget();
  const { live } = useAccounts();
  return [live.length > 1 && live.some(account => account.id === scope) ? scope : null, setScope];
}

/** Core's overview or forecast, of the chosen account or of all. */
function useScoped<R>(all: 'get_overview' | 'get_forecast', one: 'get_account_overview' | 'get_account_forecast'): R {
  const [scope] = useAccountScope();
  const ask = useCoreQuery as (command: CommandName, args?: { accountId: string }) => unknown;
  return (scope ? ask(one, { accountId: scope }) : ask(all)) as R;
}

/** The overview of the account chosen (useAccountScope), or of every account together. */
export const useOverview = () => useScoped<Overview>('get_overview', 'get_account_overview');

/** The forecast of the account chosen, or of every account together. */
export const useForecast = () => useScoped<ForecastView>('get_forecast', 'get_account_forecast');

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
  | 'settle'
  | 'record'
  | 'save_account'
  | 'archive_account'
  | 'delete_account';

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
