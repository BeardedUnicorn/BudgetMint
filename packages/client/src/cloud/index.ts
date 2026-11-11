/**
 * Firebase for the app: the store (loaded as its own chunk, once the app
 * starts) and the session over it.
 */

import type { BudgetStore, CloudConfig } from './types';

export type { BudgetStore, CloudConfig, CloudUser, DocsSnapshot } from './types';
export { BudgetSession, type SessionView, type SessionPhase } from './session';
export { cloudErrorMessage } from './errors';

/** Loads Firebase's SDK (its own chunk) and makes the store for `config`. */
export const loadFirebase = (config: CloudConfig) => (): Promise<BudgetStore> =>
  import('./firebaseStore').then(({ createFirebaseStore }) => createFirebaseStore(config));
