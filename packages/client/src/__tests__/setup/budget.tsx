/**
 * A signed-in BudgetMint for tests: the fake store with the documents a
 * test gives, the real core (at TEST_NOW, in Chicago), the fake shell, and
 * the app rendered over them.
 */

import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ForecastDoc, Item, Override, Settings } from '@budgetmint/contracts';
import { App } from '../../App';
import { BudgetSession } from '../../cloud/session';
import { setShell } from '../../shell';
import type { AppExtensions } from '../../shell/types';
import { cal, createFakeShell, createFakeStore, TEST_NOW, testCore } from '../../testing';

export { TEST_NOW };
/** TEST_NOW's day in Chicago. */
export const TODAY = '2026-11-10';
const STAMP = '2026-11-01T00:00:00Z';

type ItemSeed = Pick<Item, 'id' | 'kind' | 'name' | 'schedule'> & Partial<Item>;

export function item(seed: ItemSeed): Item {
  return {
    category: null,
    autopay: false,
    reminder: null,
    archived: false,
    note: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...seed,
  };
}

/** A monthly bill on `day`, from Oct 1. */
export function monthly(id: string, name: string, day: number, cents: number, more: Partial<Item> = {}): Item {
  return item({
    id,
    kind: 'bill',
    name,
    schedule: [{ from: '2026-10-01', until: null, repeat: { every: 'months', n: 1, day }, amountCents: cents }],
    ...more,
  });
}

export function override(seed: Pick<Override, 'itemId' | 'date' | 'status'> & Partial<Override>): Override {
  return { amountCents: null, movedTo: null, note: null, updatedAt: STAMP, ...seed };
}

/** TaskMint's forecast document, from the forecast's fields. */
export function forecastDoc(forecast: Record<string, unknown>, appVersion = '4.2.0'): ForecastDoc {
  return {
    json: JSON.stringify({ schema: 1, fundsReleaseDays: 7, withdrawalIntervalMs: 3 * 86_400_000, ...forecast }),
    schema: 1,
    appVersion,
    updatedAtMs: TEST_NOW - 3_600_000,
  };
}

/** Settings as a test gives them: any part (core fills in the rest). */
type SettingsSeed = {
  [K in keyof Settings]?: Settings[K] extends object | null ? Partial<NonNullable<Settings[K]>> | null : Settings[K];
};

export interface Seed {
  /** The settings document (none: onboarding comes first). */
  settings?: SettingsSeed | null;
  items?: Item[];
  overrides?: Override[];
  forecast?: ForecastDoc | null;
  shell?: ReturnType<typeof createFakeShell>;
  extensions?: AppExtensions;
}

/** A balance of $1,000 at the end of yesterday. */
export const SETTLED: SettingsSeed = { balance: { cents: 100_000, asOf: '2026-11-09' } };

export function seededStore({ settings = SETTLED, items = [], overrides = [], forecast = null }: Seed = {}) {
  const store = createFakeStore();
  if (settings) store.putDoc('settings~account', JSON.stringify(settings));
  for (const seed of items) store.putDoc(`item~${seed.id}`, JSON.stringify(seed));
  for (const seed of overrides) store.putDoc(`occ~${seed.date}~${seed.itemId}`, JSON.stringify(seed));
  store.publishForecast(forecast);
  return store;
}

/** Signed in and ready, with the app rendered. */
export async function startBudget(seed: Seed = {}) {
  const shell = seed.shell ?? createFakeShell();
  setShell(shell);
  const store = seededStore(seed);
  const core = testCore();
  const session = new BudgetSession(store, core, 'desk', null, { historyDays: 400, clock: () => TEST_NOW });
  session.start();
  store.setUser(cal());
  await waitFor(() => expect(session.getView().phase).toBe('ready'));
  const user = userEvent.setup();
  const rendered = render(<App session={session} core={core} extensions={seed.extensions} />);
  return { store, core, session, shell, user, ...rendered };
}
