/**
 * BudgetMint's view of Firebase (Auth and Firestore), as a seam: the
 * session (session.ts) uses only this, so it runs the same over the real
 * SDK (firebaseStore.ts) and over the fake the tests use.
 *
 * Two projects: BudgetMint's own (its accounts and data) and TaskMint's,
 * signed in to alongside with the same email and password or Google account,
 * for TaskMint's forecast only. BudgetMint's data is laid out in
 * crates/budgetmint-core/src/docs.rs and guarded by its rules
 * (rules/firestore.rules): `budgetmint/{uid}` holds the epoch,
 * `budgetmint/{uid}/data/{docId}` one document each. In TaskMint's project
 * it reads `users/{uid}/published/payoutForecast` and writes nothing.
 */

import type { DocWrite, ForecastDoc, IncomingDoc } from '@budgetmint/contracts';

/** A Firebase web app's config, as the console gives it. */
export interface FirebaseWebApp {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

/** What a shell's build passes in (its Firebase web apps). */
export interface CloudConfig {
  /** BudgetMint's own: its accounts and data. */
  firebase: FirebaseWebApp;
  /** TaskMint's, for its forecast. */
  taskmint: FirebaseWebApp;
  /**
   * Firestore's cache across launches: shared by a browser's tabs, or one
   * app's own. The data is the cloud's, so the cache is what's there offline.
   */
  cache: 'tabs' | 'single' | 'memory';
  /** Google sign-in in a popup (a browser). The apps' webviews can't open one. */
  popupSignIn: boolean;
  /** Development builds: the Auth and Firestore emulators on this host. */
  emulatorHost?: string;
}

export interface CloudUser {
  uid: string;
  email: string | null;
  /** How they sign in: "password", "google.com". */
  providers: string[];
}

/** Which of the account's documents a snapshot is of. */
export type DocsSource = 'settings' | 'items' | 'occurrences';

/** What changed in one of the listened-to sets of documents. */
export interface DocsSnapshot {
  source: DocsSource;
  /** Changed documents (null JSON: deleted), this device's unsent writes included. */
  docs: IncomingDoc[];
  /** Only the cache answered (offline, or not yet heard from the server). */
  fromCache: boolean;
  /** Some of it is this device's writes the server doesn't have yet. */
  pendingWrites: boolean;
}

/** Written into every document. */
export interface WriteMeta {
  deviceId: string;
  epoch: number;
}

export type Unsubscribe = () => void;

export interface BudgetStore {
  /** The signed-in user, now and whenever it changes. */
  onUser(listener: (user: CloudUser | null) => void): Unsubscribe;
  /**
   * Signs in to BudgetMint, and to TaskMint with the same email and password
   * where TaskMint has that account (not having it is no error).
   */
  signIn(email: string, password: string): Promise<void>;
  /** Makes a BudgetMint account (never a TaskMint one), and signs in to TaskMint as `signIn` does. */
  signUp(email: string, password: string): Promise<void>;
  /** BudgetMint's password: TaskMint's is TaskMint's to reset. */
  resetPassword(email: string): Promise<void>;
  /**
   * With a Google ID token the shell got itself, or (null) in a popup; and
   * to TaskMint with the same Google account where TaskMint has it.
   */
  signInWithGoogle(idToken: string | null): Promise<void>;
  /** Signs out of both. */
  signOut(): Promise<void>;
  /**
   * Deletes the signed-in user's BudgetMint account (Firebase may ask them
   * to sign in again first), and signs out of TaskMint: TaskMint's account
   * is left alone.
   */
  deleteUser(): Promise<void>;
  /** Whether they signed in recently enough for Firebase to delete the account. */
  signedInRecently(): Promise<boolean>;
  /**
   * Erases this device's copy of the data (both projects' caches), once
   * signed out. The store can't be used after: the app starts over. Never
   * fails: what can't be erased (another tab has it open) is logged.
   */
  clearDevice(): Promise<void>;

  /** Who's signed in to TaskMint (null: nobody), now and whenever it changes. */
  onTaskMint(listener: (user: CloudUser | null) => void): Unsubscribe;
  /** Signs in to TaskMint alone: when its password isn't BudgetMint's. */
  signInToTaskMint(email: string, password: string): Promise<void>;
  /**
   * Signs in to TaskMint alone with Google (an ID token, or null: a popup).
   * Refuses (errors.ts's NO_TASKMINT_ACCOUNT) a Google account TaskMint
   * doesn't have, making none.
   */
  signInToTaskMintWithGoogle(idToken: string | null): Promise<void>;
  signOutOfTaskMint(): Promise<void>;
  /** BudgetMint's epoch for the account; null when it has none yet. */
  account(uid: string): Promise<number | null>;
  /** Starts BudgetMint's data for the account on its first epoch. */
  createAccount(uid: string): Promise<number>;
  /** The epoch as the server has it, as it changes (null: deleted). */
  watchAccount(uid: string, listener: (epoch: number | null) => void, onError: (error: unknown) => void): Unsubscribe;
  /**
   * The settings, every item, and the occurrences from `occurrencesFrom`
   * (YYYY-MM-DD) on, as they change. A document from before `epoch` (the
   * account's now) is what a delete cut short left: it reads as deleted.
   */
  listen(
    uid: string,
    epoch: number,
    occurrencesFrom: string,
    onDocs: (snapshot: DocsSnapshot) => void,
    onError: (error: unknown) => void
  ): Unsubscribe;
  /** TaskMint's payout forecast for TaskMint's user `uid`, as it changes (null: there's none). */
  watchForecast(
    uid: string,
    listener: (doc: ForecastDoc | null) => void,
    onError: (error: unknown) => void
  ): Unsubscribe;
  /** Writes core's planned documents. Resolves once the server has them (offline: later). */
  write(uid: string, writes: DocWrite[], meta: WriteMeta): Promise<void>;
  /** Moves BudgetMint's data to the next epoch and deletes it; the new epoch. */
  deleteAll(uid: string, epoch: number): Promise<number>;
}
