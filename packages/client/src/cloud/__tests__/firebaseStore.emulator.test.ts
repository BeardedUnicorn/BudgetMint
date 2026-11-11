/**
 * BudgetMint's real Firestore store against TaskMint's rules (the pinned
 * copy in firebase/), on the emulator: scripts/test-emulator.sh runs it in
 * a fresh emulator. Every kind of document BudgetMint writes must pass the
 * rules, a write from an old epoch must not, and BudgetMint must leave
 * nothing outside `budgetmint/`.
 */

import { describe, expect, it, vi } from 'vitest';
import type { DocWrite } from '@budgetmint/contracts';
import { createFirebaseStore } from '../firebaseStore';
import type { CloudUser, DocsSnapshot } from '../types';
import { testCore } from '../../testing';

const PROJECT = 'demo-budgetmint';
const HOST = '127.0.0.1';

const store = await createFirebaseStore({
  firebase: {
    apiKey: 'demo',
    authDomain: `${PROJECT}.firebaseapp.com`,
    projectId: PROJECT,
    storageBucket: '',
    messagingSenderId: '',
    appId: 'demo',
  },
  cache: 'memory',
  popupSignIn: false,
  emulatorHost: HOST,
});

const signedIn = () =>
  new Promise<CloudUser>(resolve => {
    const stop = store.onUser(user => {
      if (user) {
        stop();
        resolve(user);
      }
    });
  });

/** The emulator's REST API, as its owner (past the rules). */
const owner = (path: string, init: RequestInit = {}) =>
  fetch(`http://${HOST}:8085/v1/projects/${PROJECT}/databases/(default)/documents${path}`, {
    ...init,
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
  });

/** Every snapshot `listen` gives until each source has answered. */
const firstSnapshots = (uid: string, epoch: number) =>
  new Promise<DocsSnapshot[]>((resolve, reject) => {
    const snapshots: DocsSnapshot[] = [];
    const stop = store.listen(
      uid,
      epoch,
      '2026-10-01',
      snapshot => {
        snapshots.push(snapshot);
        if (new Set(snapshots.map(s => s.source)).size === 3) {
          stop();
          resolve(snapshots);
        }
      },
      reject
    );
  });

/** The top-level collections in the emulator, as its owner sees them. */
async function topLevelCollections(): Promise<string[]> {
  const reply = await fetch(
    `http://${HOST}:8085/v1/projects/${PROJECT}/databases/(default)/documents:listCollectionIds`,
    { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: '{}' }
  );
  return ((await reply.json()) as { collectionIds?: string[] }).collectionIds ?? [];
}

describe("BudgetMint's store on TaskMint's rules", () => {
  it('writes, reads and deletes only its own documents', async () => {
    const core = testCore();
    const user = signedIn();
    await store.signUp(`emulator-${Date.now()}@example.com`, 'a long enough password');
    const { uid } = await user;
    expect(await store.account(uid)).toBeNull();
    expect(await store.createAccount(uid)).toBe(1);

    // One of each kind: the settings, an item and an occurrence
    const writes: DocWrite[] = [
      ...core.call('set_balance', { balance: { cents: 100_000, asOf: '2026-11-10' } }).writes,
      ...core.call('save_item', {
        item: {
          id: 'rent',
          kind: 'bill',
          name: 'Rent',
          category: null,
          schedule: [
            { from: '2026-11-01', until: null, repeat: { every: 'months', n: 1, day: 1 }, amountCents: 120_000 },
          ],
          autopay: false,
          reminder: null,
          archived: false,
          note: null,
        },
      }).writes,
    ];
    await store.write(uid, writes, { deviceId: 'emulator', epoch: 1 });
    core.call('apply_docs', { docs: writes.map(w => ({ docId: w.docId, json: w.json, schema: w.schema })) });
    const paid = core.call('set_occurrence', {
      occurrence: {
        itemId: 'rent',
        date: '2026-11-01',
        status: { state: 'done', on: '2026-11-01', amountCents: 120_000 },
        amountCents: null,
        movedTo: null,
        note: null,
      },
    }).writes;
    await store.write(uid, paid, { deviceId: 'emulator', epoch: 1 });
    expect(new Set([...writes, ...paid].map(w => w.kind))).toEqual(new Set(['settings', 'item', 'occ']));

    // They read back, and TaskMint's forecast reads as none, not a refusal
    const seen = await firstSnapshots(uid, 1);
    expect(seen.flatMap(s => s.docs).map(d => d.docId)).toEqual(
      expect.arrayContaining(['settings~account', 'item~rent', 'occ~2026-11-01~rent'])
    );
    const forecast = await new Promise((resolve, reject) => {
      const stop = store.watchForecast(
        uid,
        doc => {
          stop();
          resolve(doc);
        },
        reject
      );
    });
    expect(forecast).toBeNull();
    expect(await store.hasTaskMintData(uid)).toBe(false);

    // Deleting moves the data to the next epoch; a write from the old one is refused
    expect(await store.deleteAll(uid, 1)).toBe(2);
    await expect(store.write(uid, writes, { deviceId: 'emulator', epoch: 1 })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await store.write(uid, writes, { deviceId: 'emulator', epoch: 2 });

    // A delete cut short (the epoch moved on, the documents left): they read
    // as deleted, and are deleted again
    await owner(`/budgetmint/${uid}?updateMask.fieldPaths=epoch`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { epoch: { integerValue: '3' } } }),
    });
    const left = (await firstSnapshots(uid, 3)).flatMap(s => s.docs);
    expect(left.map(d => d.docId)).toEqual(expect.arrayContaining(['settings~account', 'item~rent']));
    expect(left.every(d => d.json === null)).toBe(true);
    await vi.waitFor(async () => {
      const listed = (await (await owner(`/budgetmint/${uid}/data`)).json()) as { documents?: unknown[] };
      expect(listed.documents ?? []).toHaveLength(0);
    });

    // Nothing outside budgetmint/
    expect(await topLevelCollections()).toEqual(['budgetmint']);
    await store.signOut();
  });
});
