/**
 * BudgetMint's view of Firebase (Auth and Firestore), as a seam: the
 * session (session.ts) uses only this, so it runs the same over the real
 * SDK (firebaseStore.ts) and over the fake the tests use.
 *
 * The data is laid out in crates/budgetmint-core/src/docs.rs and guarded by
 * TaskMint's rules (firebase/firestore.rules, pinned here): `budgetmint/{uid}`
 * holds the epoch, `budgetmint/{uid}/data/{docId}` one document each. It
 * reads TaskMint's `users/{uid}/published/payoutForecast` and writes nothing
 * under `users/`.
 */

import type { DocWrite, ForecastDoc, IncomingDoc } from '@budgetmint/contracts';

/** What a shell's build passes in (its Firebase web app). */
export interface CloudConfig {
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
    measurementId?: string;
  };
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
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  /** With a Google ID token the shell got itself, or (null) in a popup. */
  signInWithGoogle(idToken: string | null): Promise<void>;
  signOut(): Promise<void>;
  /** Deletes the signed-in user's account (Firebase may ask them to sign in again first). */
  deleteUser(): Promise<void>;
  /** Whether they signed in recently enough for Firebase to delete the account. */
  signedInRecently(): Promise<boolean>;
  /** BudgetMint's epoch for the account; null when it has none yet. */
  account(uid: string): Promise<number | null>;
  /** Starts BudgetMint's data for the account on its first epoch. */
  createAccount(uid: string): Promise<number>;
  /** The epoch as the server has it, as it changes (null: deleted). */
  watchAccount(uid: string, listener: (epoch: number | null) => void, onError: (error: unknown) => void): Unsubscribe;
  /**
   * The settings, every item, and the occurrences from `occurrencesFrom`
   * (YYYY-MM-DD) on, as they change.
   */
  listen(
    uid: string,
    occurrencesFrom: string,
    onDocs: (snapshot: DocsSnapshot) => void,
    onError: (error: unknown) => void
  ): Unsubscribe;
  /** TaskMint's payout forecast, as it changes (null: there's none). */
  watchForecast(
    uid: string,
    listener: (doc: ForecastDoc | null) => void,
    onError: (error: unknown) => void
  ): Unsubscribe;
  /** Writes core's planned documents. Resolves once the server has them (offline: later). */
  write(uid: string, writes: DocWrite[], meta: WriteMeta): Promise<void>;
  /** Moves BudgetMint's data to the next epoch and deletes it; the new epoch. */
  deleteAll(uid: string, epoch: number): Promise<number>;
  /** Whether the account has TaskMint data (then it's TaskMint's to delete). */
  hasTaskMintData(uid: string): Promise<boolean>;
}
