/**
 * A BudgetStore in memory, for tests: the test signs users in and out, sets
 * epochs, puts documents in the "cloud" and publishes TaskMint forecasts.
 * Signing in signs in to TaskMint too, as the same user (the accounts
 * match), unless the test says otherwise with setTaskMintUser.
 * Like Firestore's cache, a write reaches the listeners at once (as pending
 * until `confirm`). Each method is a vi.fn, so a test can make one fail or
 * check its calls.
 */

import { vi } from 'vitest';
import type { DocWrite, ForecastDoc } from '@budgetmint/contracts';
import type { BudgetStore, CloudUser, DocsSnapshot, DocsSource, WriteMeta } from '../cloud/types';

export interface FakeStore extends BudgetStore {
  /** Signs in (or out) of BudgetMint, and TaskMint as the same user. */
  setUser(user: CloudUser | null): void;
  /** Who's signed in to TaskMint alone. */
  setTaskMintUser(user: CloudUser | null): void;
  /** BudgetMint's epoch as the cloud has it (null: none), told to its watchers. */
  setEpoch(uid: string, epoch: number | null): void;
  /** Puts a document in the cloud (null JSON: deletes it) and tells the listeners, as the server. */
  putDoc(docId: string, json: string | null, schema?: number): void;
  /** TaskMint's forecast (null: none), told to its watchers. */
  publishForecast(doc: ForecastDoc | null): void;
  /** Fails the open listeners. */
  failListen(error: unknown): void;
  failForecast(error: unknown): void;
  /** The cloud's documents. */
  readonly docs: Map<string, { json: string; schema: number }>;
  readonly writes: { uid: string; writes: DocWrite[]; meta: WriteMeta }[];
  /** When true, listeners answer from the cache (offline). */
  offline: boolean;
}

export function cal(uid = 'cal'): CloudUser {
  return { uid, email: `${uid}@example.com`, providers: ['password'] };
}

const sourceOf = (docId: string): DocsSource =>
  docId.startsWith('settings~') ? 'settings' : docId.startsWith('item~') ? 'items' : 'occurrences';

export function createFakeStore(): FakeStore {
  let user: CloudUser | null = null;
  const userListeners = new Set<(user: CloudUser | null) => void>();
  let taskmintUser: CloudUser | null = null;
  const taskmintListeners = new Set<(user: CloudUser | null) => void>();
  const epochs = new Map<string, number>();
  const docs: FakeStore['docs'] = new Map();
  const epochWatchers = new Set<{ uid: string; listener: (epoch: number | null) => void }>();
  type Open = { onDocs: (snapshot: DocsSnapshot) => void; onError: (error: unknown) => void; from: string };
  const listening = new Set<Open>();
  const forecastWatchers = new Set<{
    listener: (doc: ForecastDoc | null) => void;
    onError: (error: unknown) => void;
  }>();
  let forecast: ForecastDoc | null = null;
  const writes: FakeStore['writes'] = [];

  const tell = (docId: string, json: string | null, schema: number, pending: boolean) => {
    for (const open of listening) {
      if (sourceOf(docId) === 'occurrences' && docId < `occ~${open.from}`) continue;
      open.onDocs({
        source: sourceOf(docId),
        docs: [{ docId, json, schema }],
        fromCache: store.offline,
        pendingWrites: pending,
      });
    }
  };

  const store: FakeStore = {
    offline: false,
    docs,
    writes,
    onUser: vi.fn((listener: (user: CloudUser | null) => void) => {
      userListeners.add(listener);
      listener(user);
      return () => userListeners.delete(listener);
    }),
    signIn: vi.fn(async (email: string) => store.setUser(cal(email.split('@')[0]))),
    signUp: vi.fn(async (email: string) => store.setUser(cal(email.split('@')[0]))),
    resetPassword: vi.fn(async () => undefined),
    signInWithGoogle: vi.fn(async () => store.setUser({ ...cal(), providers: ['google.com'] })),
    signOut: vi.fn(async () => store.setUser(null)),
    deleteUser: vi.fn(async () => store.setUser(null)),
    signedInRecently: vi.fn(async () => true),
    onTaskMint: vi.fn((listener: (user: CloudUser | null) => void) => {
      taskmintListeners.add(listener);
      listener(taskmintUser);
      return () => taskmintListeners.delete(listener);
    }),
    signInToTaskMint: vi.fn(async (email: string) => store.setTaskMintUser(cal(email.split('@')[0]))),
    signInToTaskMintWithGoogle: vi.fn(async () => store.setTaskMintUser({ ...cal(), providers: ['google.com'] })),
    signOutOfTaskMint: vi.fn(async () => store.setTaskMintUser(null)),
    account: vi.fn(async (uid: string) => epochs.get(uid) ?? null),
    createAccount: vi.fn(async (uid: string) => {
      epochs.set(uid, 1);
      return 1;
    }),
    watchAccount: vi.fn((uid: string, listener: (epoch: number | null) => void) => {
      const watcher = { uid, listener };
      epochWatchers.add(watcher);
      return () => epochWatchers.delete(watcher);
    }),
    // Every document here is the epoch's: a delete is never cut short
    listen: vi.fn(
      (
        _uid: string,
        _epoch: number,
        from: string,
        onDocs: (s: DocsSnapshot) => void,
        onError: (e: unknown) => void
      ) => {
        const open = { onDocs, onError, from };
        listening.add(open);
        // The first answer: what's there, per source
        for (const source of ['settings', 'items', 'occurrences'] as const) {
          const found = [...docs]
            .filter(([docId]) => sourceOf(docId) === source && !(source === 'occurrences' && docId < `occ~${from}`))
            .map(([docId, doc]) => ({ docId, json: doc.json, schema: doc.schema }));
          onDocs({
            source,
            docs:
              source === 'settings' && found.length === 0
                ? [{ docId: 'settings~account', json: null, schema: 1 }]
                : found,
            fromCache: store.offline,
            pendingWrites: false,
          });
        }
        return () => listening.delete(open);
      }
    ),
    watchForecast: vi.fn((_uid: string, listener: (doc: ForecastDoc | null) => void, onError: (e: unknown) => void) => {
      const watcher = { listener, onError };
      forecastWatchers.add(watcher);
      listener(forecast);
      return () => forecastWatchers.delete(watcher);
    }),
    write: vi.fn(async (uid: string, planned: DocWrite[], meta: WriteMeta) => {
      writes.push({ uid, writes: planned, meta });
      for (const write of planned) {
        if (write.json === null) docs.delete(write.docId);
        else docs.set(write.docId, { json: write.json, schema: write.schema });
        tell(write.docId, write.json, write.schema, true);
      }
    }),
    deleteAll: vi.fn(async (uid: string, epoch: number) => {
      for (const docId of [...docs.keys()]) {
        docs.delete(docId);
        tell(docId, null, 1, false);
      }
      store.setEpoch(uid, epoch + 1);
      return epoch + 1;
    }),

    setUser(next) {
      user = next;
      for (const listener of [...userListeners]) listener(next);
      store.setTaskMintUser(next);
    },
    setTaskMintUser(next) {
      taskmintUser = next;
      for (const listener of [...taskmintListeners]) listener(next);
    },
    setEpoch(uid, epoch) {
      if (epoch === null) epochs.delete(uid);
      else epochs.set(uid, epoch);
      for (const watcher of [...epochWatchers]) if (watcher.uid === uid) watcher.listener(epoch);
    },
    putDoc(docId, json, schema = 1) {
      if (json === null) docs.delete(docId);
      else docs.set(docId, { json, schema });
      tell(docId, json, schema, false);
    },
    publishForecast(doc) {
      forecast = doc;
      for (const watcher of [...forecastWatchers]) watcher.listener(doc);
    },
    failListen(error) {
      for (const open of [...listening]) open.onError(error);
    },
    failForecast(error) {
      for (const watcher of [...forecastWatchers]) watcher.onError(error);
    },
  };
  return store;
}
