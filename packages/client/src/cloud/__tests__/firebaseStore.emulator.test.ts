/**
 * BudgetMint's real Firestore store on the emulator, in two projects as in
 * production: its own under its rules (rules/firestore.rules, which the
 * emulator loads), and TaskMint's under TaskMint's (the pinned copy in
 * firebase/, loaded here). scripts/test-emulator.sh runs it in a fresh
 * emulator. Every kind of document BudgetMint writes must pass its rules, a
 * write from an old epoch must not, TaskMint's forecast must read under
 * TaskMint's, and BudgetMint must write nothing at all in TaskMint's project.
 *
 * The Auth emulator keeps one set of accounts for every project, so signing
 * up to BudgetMint signs in to TaskMint alongside as the same user, as when
 * the two accounts match.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { DocWrite, ForecastDoc } from '@budgetmint/contracts';
import { createFirebaseStore } from '../firebaseStore';
import type { CloudUser, DocsSnapshot, FirebaseWebApp } from '../types';
import { testCore } from '../../testing';

const PROJECT = 'demo-budgetmint';
const TASKMINT = 'demo-taskmint';
const HOST = '127.0.0.1';

const webApp = (projectId: string): FirebaseWebApp => ({
  apiKey: 'demo',
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
  storageBucket: '',
  messagingSenderId: '',
  appId: projectId,
});

const store = await createFirebaseStore({
  firebase: webApp(PROJECT),
  taskmint: webApp(TASKMINT),
  cache: 'memory',
  popupSignIn: false,
  emulatorHost: HOST,
});

/** The first user `on` reports. */
const firstUser = (on: (listener: (user: CloudUser | null) => void) => () => void) =>
  new Promise<CloudUser>(resolve => {
    const stop = on(user => {
      if (user) {
        stop();
        resolve(user);
      }
    });
  });

/** A project's documents in the emulator's REST API, as its owner (past the rules). */
const ownerOf =
  (project: string) =>
  (path: string, init: RequestInit = {}) =>
    fetch(`http://${HOST}:8085/v1/projects/${project}/databases/(default)/documents${path}`, {
      ...init,
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    });
const owner = ownerOf(PROJECT);
const taskmintOwner = ownerOf(TASKMINT);

beforeAll(async () => {
  // TaskMint's rules, for TaskMint's project (the tests run in packages/client)
  const rules = readFileSync(join(process.cwd(), '../../firebase/firestore.rules'), 'utf8');
  const loaded = await fetch(`http://${HOST}:8085/emulator/v1/projects/${TASKMINT}:securityRules`, {
    method: 'PUT',
    body: JSON.stringify({ rules: { files: [{ content: rules }] } }),
  });
  expect(loaded.ok).toBe(true);
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
        if (new Set(snapshots.map(s => s.source)).size === 4) {
          stop();
          resolve(snapshots);
        }
      },
      reject
    );
  });

/** The collections under `path` in a project, as its owner sees them. */
async function collections(project: string, path = ''): Promise<string[]> {
  const reply = await ownerOf(project)(`${path}:listCollectionIds`, { method: 'POST', body: '{}' });
  return ((await reply.json()) as { collectionIds?: string[] }).collectionIds ?? [];
}

/** The forecast `watchForecast` gives once it has one. */
const forecastOf = (uid: string) =>
  new Promise<ForecastDoc>((resolve, reject) => {
    const stop = store.watchForecast(
      uid,
      doc => {
        if (doc) {
          stop();
          resolve(doc);
        }
      },
      reject
    );
  });

describe("BudgetMint's store, in its own project and TaskMint's", () => {
  it('writes, reads and deletes only its own documents, and only reads TaskMint’s forecast', async () => {
    const core = testCore();
    const user = firstUser(store.onUser);
    const taskmintUser = firstUser(store.onTaskMint);
    await store.signUp(`emulator-${Date.now()}@example.com`, 'a long enough password');
    const { uid } = await user;
    const taskmint = await taskmintUser;
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
            {
              from: '2026-11-01',
              until: null,
              repeat: { every: 'months', n: 1, day: 1 },
              amountCents: 120_000,
              weekends: 'keep',
            },
          ],
          autopay: false,
          reminder: null,
          archived: false,
          varies: false,
          saveUp: false,
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
    // A bank account, and money moved to it: the newest documents
    const savings = core.call('save_account', { account: { id: 'savings', name: 'Savings' } }).writes;
    const transfer = core.call('save_item', {
      item: {
        id: 'to-savings',
        kind: 'transfer',
        name: 'To savings',
        schedule: [{ from: '2026-11-15', repeat: { every: 'once' }, amountCents: 5_000 }],
        toAccountId: 'savings',
      },
    }).writes;
    await store.write(uid, [...savings, ...transfer], { deviceId: 'emulator', epoch: 1 });
    expect(new Set([...writes, ...paid, ...savings].map(w => w.kind))).toEqual(
      new Set(['settings', 'item', 'occ', 'account'])
    );
    expect([...savings, ...transfer].map(w => w.schema)).toEqual([4, 4]);

    // They read back
    const seen = await firstSnapshots(uid, 1);
    expect(seen.flatMap(s => s.docs).map(d => d.docId)).toEqual(
      expect.arrayContaining([
        'settings~account',
        'item~rent',
        'occ~2026-11-01~rent',
        'account~savings',
        'item~to-savings',
      ])
    );

    // A BudgetMint from before bank accounts writes schema 2: refused on the transfer (it holds
    // it unread, and would write it back as a bill), while its own documents still save
    const older = (write: DocWrite): DocWrite => ({ ...write, schema: 2 });
    await expect(store.write(uid, transfer.map(older), { deviceId: 'older', epoch: 1 })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await store.write(uid, writes.map(older), { deviceId: 'older', epoch: 1 });

    // TaskMint's forecast, as TaskMint publishes it, reads under TaskMint's rules
    const published = await taskmintOwner(`/users/${taskmint.uid}/published/payoutForecast`, {
      method: 'PATCH',
      body: JSON.stringify({
        fields: {
          schema: { integerValue: '1' },
          json: { stringValue: '{"forecast":true}' },
          hash: { stringValue: 'h' },
          deviceId: { stringValue: 'taskmint-desk' },
          appVersion: { stringValue: '4.2.0' },
          epoch: { integerValue: '1' },
          updatedAt: { timestampValue: '2026-11-10T12:00:00Z' },
        },
      }),
    });
    expect(published.ok).toBe(true);
    expect(await forecastOf(taskmint.uid)).toEqual({
      json: '{"forecast":true}',
      schema: 1,
      appVersion: '4.2.0',
      updatedAtMs: Date.parse('2026-11-10T12:00:00Z'),
    });

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

    // Nothing outside budgetmint/, and nothing at all in TaskMint's project but its forecast
    expect(await collections(PROJECT)).toEqual(['budgetmint']);
    expect(await collections(TASKMINT)).toEqual(['users']);
    expect(await collections(TASKMINT, `/users/${taskmint.uid}`)).toEqual(['published']);
    const taskmintDocs = (await (await taskmintOwner(`/users/${taskmint.uid}/published`)).json()) as {
      documents: { name: string; updateTime: string }[];
    };
    expect(taskmintDocs.documents.map(doc => doc.name.split('/').at(-1))).toEqual(['payoutForecast']);
    expect(taskmintDocs.documents[0].updateTime).toBe(((await published.json()) as { updateTime: string }).updateTime);
    await store.signOut();
  });
});
