/**
 * TaskMint's forecast as the pages word it: why its withdrawals aren't
 * shown when they aren't, and whether its numbers are getting old.
 */

import type { ForecastState, ForecastStatus } from '@budgetmint/contracts';

/** TaskMint warns when its work logs haven't been imported for three days; so does BudgetMint. */
export const STALE_IMPORT_MS = 3 * 24 * 60 * 60 * 1000;

/** Whether TaskMint's work logs were last imported long enough ago that its numbers may be out of date. */
export const importIsStale = (status: ForecastStatus, nowMs: number) =>
  status.lastImportMs !== null && nowMs - status.lastImportMs > STALE_IMPORT_MS;

/** In a few words, why there's no withdrawal to show (the forecast read, or why not). */
export const WITHDRAWALS_NOTE: Record<ForecastState, string> = {
  checking: 'Checking TaskMint…',
  ready: 'Nothing to withdraw yet',
  missing: 'TaskMint isn’t connected',
  newer: 'Update BudgetMint to read TaskMint',
  unreadable: 'TaskMint’s forecast can’t be read',
};

/** Why the forecast counts no withdrawals, as a sentence (null: it counts them). */
export const LEFT_OUT: Record<ForecastState, string | null> = {
  checking: 'TaskMint’s forecast hasn’t been read yet.',
  ready: null,
  missing: 'TaskMint isn’t connected, so its withdrawals aren’t counted.',
  newer: 'TaskMint’s forecast is from a newer version: update BudgetMint to count its withdrawals.',
  unreadable: 'TaskMint’s forecast can’t be read, so its withdrawals aren’t counted.',
};
