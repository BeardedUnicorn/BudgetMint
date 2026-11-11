/**
 * The signed-in account, on this device: it reads BudgetMint's documents
 * into core as they change (this device's writes at once, from Firestore's
 * cache) and, from whoever is signed in to TaskMint alongside, TaskMint's
 * payout forecast, and writes what core plans.
 *
 * - Signing in starts BudgetMint's data for the account if it has none.
 * - Deleting the data (from any device) moves it to a new epoch: the rules
 *   refuse the old one's writes, and every device starts over on the new.
 * - Offline, Firestore's cache answers and keeps the writes until it's back.
 */

import type { DocWrite, ForecastStatus } from '@budgetmint/contracts';
import type { CoreClient } from '../core';
import { cloudErrorMessage } from './errors';
import type { BudgetStore, CloudUser, DocsSnapshot, DocsSource, Unsubscribe } from './types';

export type SessionPhase =
  /** Firebase is loading. */
  | 'loading'
  | 'signedOut'
  /** Reading the account's data. */
  | 'starting'
  | 'ready'
  | 'error';

export interface SessionView {
  phase: SessionPhase;
  user: CloudUser | null;
  error: string | null;
  /** Bumped whenever core's data changes: the pages ask core again. */
  version: number;
  /** Showing what this device has: offline, or not yet heard from the cloud. */
  offline: boolean;
  /** Changes made here that the cloud doesn't have yet. */
  saving: boolean;
  /** Documents from a newer BudgetMint, left alone. */
  held: number;
  /** Documents that don't read as BudgetMint's (damaged): left out. */
  unreadable: number;
  /** The data was deleted on another device, so this one started over. */
  resetElsewhere: boolean;
  taskmint: ForecastStatus;
  /** Who's signed in to TaskMint, for its forecast (null: nobody, or not known yet). */
  taskmintUser: CloudUser | null;
}

export interface SessionOptions {
  /** How far back occurrences are read (the history pages show). */
  historyDays: number;
  /** Now, in milliseconds. */
  clock: () => number;
}

export const SESSION_OPTIONS: SessionOptions = { historyDays: 400, clock: Date.now };

const SOURCES: DocsSource[] = ['settings', 'items', 'occurrences'];

/** Before the cloud has said what TaskMint published (core's state then too). */
const NO_FORECAST: ForecastStatus = {
  state: 'checking',
  appVersion: null,
  publishedAtMs: null,
  asOfMs: null,
  lastImportMs: null,
};

/** The date `days` before `ms`, as YYYY-MM-DD where the user is. */
function dateBefore(ms: number, days: number): string {
  const date = new Date(ms);
  date.setDate(date.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export class BudgetSession {
  private view: SessionView = {
    phase: 'loading',
    user: null,
    error: null,
    version: 0,
    offline: false,
    saving: false,
    held: 0,
    unreadable: 0,
    resetElsewhere: false,
    taskmint: NO_FORECAST,
    taskmintUser: null,
  };
  private readonly listeners = new Set<() => void>();
  private unsubscribeUser: Unsubscribe | null = null;
  private unsubscribeTaskMint: Unsubscribe | null = null;
  /** Whether TaskMint's sign-in has said who's signed in yet (until then, the forecast is being checked). */
  private taskmintKnown = false;
  private watching: Unsubscribe[] = [];
  private forecast: Unsubscribe | null = null;
  private linked: { uid: string; epoch: number } | null = null;
  /** Each source's last word: whether from the cache, whether with writes pending. */
  private sources = new Map<DocsSource, DocsSnapshot>();
  /** Bumped on each change of user (or start over), so work for an earlier one is dropped. */
  private generation = 0;
  /** This device is deleting the data: the new epoch is its own doing. */
  private deletingTo: number | null = null;

  /**
   * `google` gets a Google ID token the shell's own way (null: Firebase's
   * popup does it); none when this build can't sign in with Google.
   */
  constructor(
    private readonly store: BudgetStore,
    private readonly core: CoreClient,
    private readonly deviceId: string,
    private readonly google: (() => Promise<string | null>) | null = null,
    private readonly options: SessionOptions = SESSION_OPTIONS
  ) {}

  get canUseGoogle(): boolean {
    return this.google !== null;
  }

  start(): void {
    this.unsubscribeTaskMint = this.store.onTaskMint(user => this.taskmintChanged(user));
    this.unsubscribeUser = this.store.onUser(user => void this.userChanged(user, false));
  }

  stop(): void {
    this.detach();
    this.unsubscribeUser?.();
    this.unsubscribeTaskMint?.();
  }

  getView = (): SessionView => this.view;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // ---- Signing in and out ---------------------------------------------------

  signIn = (email: string, password: string) => this.store.signIn(email, password);
  signUp = (email: string, password: string) => this.store.signUp(email, password);
  resetPassword = (email: string) => this.store.resetPassword(email);
  signInWithGoogle = async () => this.store.signInWithGoogle(await this.google!());
  signOut = () => this.store.signOut();

  /** TaskMint alone, when signing in to BudgetMint didn't (another password, or TaskMint set up since). */
  signInToTaskMint = (email: string, password: string) => this.store.signInToTaskMint(email, password);
  signInToTaskMintWithGoogle = async () => this.store.signInToTaskMintWithGoogle(await this.google!());
  signOutOfTaskMint = () => this.store.signOutOfTaskMint();

  /** After an error: starts over with the signed-in user. */
  retry = () => this.userChanged(this.view.user, false);

  /** The notice that the data was deleted elsewhere has been seen. */
  dismissReset = () => this.set({ resetElsewhere: false });

  /** The user is in another time zone now: core moves, and the pages ask it again ("today" may differ). */
  moveTo = (zone: string) => {
    this.core.setZone(zone);
    this.changed();
  };

  // ---- Changes --------------------------------------------------------------

  /**
   * Writes what core planned (or the undo of it): core and Firestore's cache
   * have it once this returns, so the pages show it at once; the promise
   * settles when the cloud has it (offline, much later), rejecting with the
   * message to show.
   */
  write(writes: DocWrite[]): Promise<void> {
    if (!this.linked) return Promise.reject(new Error('Sign in to save changes.'));
    if (writes.length === 0) return Promise.resolve();
    const { uid, epoch } = this.linked;
    // Core has a plan's writes already; an undo's it takes here. The pages show them at once
    this.core.call('apply_docs', {
      docs: writes.map(({ docId, json, schema }) => ({ docId, json, schema })),
    });
    this.changed({ saving: true });
    return this.store.write(uid, writes, { deviceId: this.deviceId, epoch }).catch(error => {
      throw new Error(cloudErrorMessage(error));
    });
  }

  /** Deletes the account's BudgetMint data, here and on every device. */
  async deleteData(): Promise<void> {
    this.needsCloud();
    const { uid, epoch } = this.linked!;
    this.deletingTo = epoch + 1;
    try {
      await this.store.deleteAll(uid, epoch);
    } catch (error) {
      this.deletingTo = null;
      throw new Error(cloudErrorMessage(error));
    }
  }

  /** Deletes the BudgetMint account and its data. TaskMint's account is TaskMint's: it's only signed out of. */
  async deleteAccount(): Promise<void> {
    this.needsCloud();
    // What can refuse comes first: once the data is deleted there's no going back
    const recent = await this.store.signedInRecently().catch(error => {
      throw new Error(cloudErrorMessage(error));
    });
    if (!recent) {
      throw new Error('Sign out and in again, then delete the account. Nothing was deleted.');
    }
    try {
      if (this.linked) await this.deleteData();
      await this.store.deleteUser();
    } catch (error) {
      throw new Error(cloudErrorMessage(error));
    }
  }

  // ---- Inside ---------------------------------------------------------------

  /** Deleting waits for the cloud's answer, which offline never comes. */
  private needsCloud(): void {
    if (this.view.offline) throw new Error('You’re offline. Connect, then delete it.');
  }

  private set(changes: Partial<SessionView>): void {
    this.view = { ...this.view, ...changes };
    for (const listener of this.listeners) listener();
  }

  private changed(changes: Partial<SessionView> = {}): void {
    this.set({ ...changes, version: this.view.version + 1 });
  }

  private detach(): void {
    for (const unsubscribe of this.watching.splice(0)) unsubscribe();
    this.forecast?.();
    this.forecast = null;
    this.linked = null;
    this.sources.clear();
  }

  private fail(error: unknown, generation: number): void {
    if (generation !== this.generation) return;
    this.detach();
    this.set({ phase: 'error', error: cloudErrorMessage(error, { reading: true }) });
  }

  private async userChanged(user: CloudUser | null, resetElsewhere: boolean): Promise<void> {
    const generation = ++this.generation;
    this.detach();
    this.core.call('reset_docs');
    const fresh = { held: 0, unreadable: 0, offline: false, saving: false, taskmint: NO_FORECAST, error: null };
    if (!user) {
      this.changed({ ...fresh, phase: 'signedOut', user: null, resetElsewhere: false });
      return;
    }
    this.changed({ ...fresh, phase: 'starting', user, resetElsewhere });
    try {
      const epoch = (await this.store.account(user.uid)) ?? (await this.store.createAccount(user.uid));
      // Signed out (or in as someone else) meanwhile
      if (generation !== this.generation) return;
      this.follow(user, epoch, generation);
    } catch (error) {
      this.fail(error, generation);
    }
  }

  private follow(user: CloudUser, epoch: number, generation: number): void {
    const { uid } = user;
    this.linked = { uid, epoch };
    const from = dateBefore(this.options.clock(), this.options.historyDays);
    this.watching.push(
      this.store.watchAccount(
        uid,
        current => {
          if (current === epoch) return;
          // Deleted here: start over quietly. Elsewhere: say so
          const own = current !== null && current === this.deletingTo;
          this.deletingTo = null;
          void this.userChanged(user, !own);
        },
        error => this.fail(error, generation)
      ),
      this.store.listen(
        uid,
        epoch,
        from,
        snapshot => this.received(snapshot),
        error => this.fail(error, generation)
      )
    );
    this.watchForecast();
  }

  private taskmintChanged(user: CloudUser | null): void {
    this.taskmintKnown = true;
    this.set({ taskmintUser: user });
    if (this.linked) this.watchForecast();
  }

  /** TaskMint's forecast, for whoever is signed in to TaskMint: none when nobody is. */
  private watchForecast(): void {
    this.forecast?.();
    this.forecast = null;
    if (!this.taskmintKnown) return;
    const none = () => this.changed({ taskmint: this.core.call('apply_forecast', { doc: null }) });
    const user = this.view.taskmintUser;
    if (!user) {
      none();
      return;
    }
    this.forecast = this.store.watchForecast(
      user.uid,
      doc => this.changed({ taskmint: this.core.call('apply_forecast', { doc }) }),
      // No forecast to read (TaskMint's rules refuse it): as if there were none
      none
    );
  }

  private received(snapshot: DocsSnapshot): void {
    const applied = this.core.call('apply_docs', { docs: snapshot.docs });
    this.sources.set(snapshot.source, snapshot);
    const all = [...this.sources.values()];
    this.changed({
      phase: SOURCES.every(source => this.sources.has(source)) ? 'ready' : 'starting',
      held: applied.held.length,
      unreadable: applied.unreadable.length,
      offline: all.some(source => source.fromCache),
      saving: all.some(source => source.pendingWrites),
    });
  }
}
