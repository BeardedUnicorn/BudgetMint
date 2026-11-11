// Adapted from TaskMint packages/client/src/cloud/__tests__/firebaseStore.test.ts @ 1623bee.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudConfig } from '../types';

// The SDK, as far as the store uses it: each call recorded
const sdk = vi.hoisted(() => {
  const batch = { set: vi.fn(), delete: vi.fn(), commit: vi.fn(async () => undefined) };
  return {
    batch,
    auth: {} as Record<string, unknown> & { currentUser?: unknown },
    db: {} as Record<string, unknown>,
    authListener: null as ((user: unknown) => void) | null,
  };
});

vi.mock('firebase/app', () => ({ initializeApp: vi.fn((_config, name) => ({ name: name ?? '[DEFAULT]' })) }));
vi.mock('firebase/auth', () => {
  const GoogleAuthProvider = Object.assign(
    vi.fn(function GoogleAuthProvider() {}),
    { credential: vi.fn((token: string) => ({ token })) }
  );
  return {
    initializeAuth: vi.fn(() => sdk.auth),
    indexedDBLocalPersistence: 'indexedDB',
    browserLocalPersistence: 'local',
    browserPopupRedirectResolver: 'popups',
    connectAuthEmulator: vi.fn(),
    onAuthStateChanged: vi.fn((_auth, listener) => {
      sdk.authListener = listener;
      return () => undefined;
    }),
    signInWithEmailAndPassword: vi.fn(async () => ({})),
    createUserWithEmailAndPassword: vi.fn(async () => ({})),
    sendPasswordResetEmail: vi.fn(async () => undefined),
    signInWithCredential: vi.fn(async () => ({})),
    signInWithPopup: vi.fn(async () => ({})),
    signOut: vi.fn(async () => undefined),
    deleteUser: vi.fn(async () => undefined),
    GoogleAuthProvider,
  };
});
vi.mock('firebase/firestore', () => ({
  initializeFirestore: vi.fn(() => sdk.db),
  memoryLocalCache: vi.fn(() => 'memory'),
  persistentLocalCache: vi.fn(options => ({ persistent: options })),
  persistentMultipleTabManager: vi.fn(() => 'tabs'),
  persistentSingleTabManager: vi.fn(() => 'single'),
  connectFirestoreEmulator: vi.fn(),
  // A path under the database, or under a collection
  doc: vi.fn((parent: { path?: string }, ...path: string[]) => ({
    path: [parent.path, ...path].filter(Boolean).join('/'),
  })),
  collection: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })),
  documentId: vi.fn(() => '__id__'),
  getDoc: vi.fn(),
  setDoc: vi.fn(async () => undefined),
  updateDoc: vi.fn(async () => undefined),
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn((ref, ...constraints) => ({ ref, constraints })),
  where: vi.fn((...args) => ['where', ...args]),
  limit: vi.fn(n => ['limit', n]),
  writeBatch: vi.fn(() => sdk.batch),
  serverTimestamp: vi.fn(() => 'SERVER_TIME'),
}));

const auth = await import('firebase/auth');
const app = await import('firebase/app');
const fs = await import('firebase/firestore');
const { BATCH_SIZE, createFirebaseStore } = await import('../firebaseStore');

const CONFIG: CloudConfig = {
  firebase: {
    apiKey: 'key',
    authDomain: 'example.firebaseapp.com',
    projectId: 'example',
    storageBucket: 'example.appspot.com',
    messagingSenderId: '1',
    appId: 'app',
  },
  cache: 'memory',
  popupSignIn: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

const metadata = (fromCache = false, hasPendingWrites = false) => ({ fromCache, hasPendingWrites });

describe('the Firebase store', () => {
  it('keeps Firestore’s cache as the shell asks, and the emulators’ apart', async () => {
    await createFirebaseStore(CONFIG);
    expect(auth.initializeAuth).toHaveBeenCalledWith(expect.anything(), { persistence: ['indexedDB', 'local'] });
    expect(fs.initializeFirestore).toHaveBeenLastCalledWith(expect.anything(), { localCache: 'memory' });
    expect(app.initializeApp).toHaveBeenLastCalledWith(CONFIG.firebase, undefined);
    expect(auth.connectAuthEmulator).not.toHaveBeenCalled();

    await createFirebaseStore({ ...CONFIG, cache: 'single' });
    expect(fs.initializeFirestore).toHaveBeenLastCalledWith(expect.anything(), {
      localCache: { persistent: { tabManager: 'single' } },
    });
    await createFirebaseStore({ ...CONFIG, cache: 'tabs', popupSignIn: true, emulatorHost: '10.0.2.2' });
    expect(fs.initializeFirestore).toHaveBeenLastCalledWith(expect.anything(), {
      localCache: { persistent: { tabManager: 'tabs' } },
    });
    expect(auth.initializeAuth).toHaveBeenLastCalledWith(expect.anything(), {
      persistence: ['indexedDB', 'local'],
      popupRedirectResolver: 'popups',
    });
    expect(app.initializeApp).toHaveBeenLastCalledWith(CONFIG.firebase, 'emulator');
    expect(auth.connectAuthEmulator).toHaveBeenCalledWith(sdk.auth, 'http://10.0.2.2:9099', { disableWarnings: true });
    expect(fs.connectFirestoreEmulator).toHaveBeenCalledWith(sdk.db, '10.0.2.2', 8085);
  });

  it('reports the signed-in user, and signs in and out every way', async () => {
    const store = await createFirebaseStore(CONFIG);
    const users: unknown[] = [];
    store.onUser(user => users.push(user));
    sdk.authListener!({ uid: 'cal', email: 'cal@example.com', providerData: [{ providerId: 'password' }] });
    sdk.authListener!(null);
    expect(users).toEqual([{ uid: 'cal', email: 'cal@example.com', providers: ['password'] }, null]);

    await store.signIn('cal@example.com', 'pw');
    expect(auth.signInWithEmailAndPassword).toHaveBeenCalledWith(sdk.auth, 'cal@example.com', 'pw');
    await store.signUp('dee@example.com', 'pw2');
    expect(auth.createUserWithEmailAndPassword).toHaveBeenCalledWith(sdk.auth, 'dee@example.com', 'pw2');
    await store.resetPassword('cal@example.com');
    expect(auth.sendPasswordResetEmail).toHaveBeenCalledWith(sdk.auth, 'cal@example.com');
    await store.signInWithGoogle('id-token');
    expect(auth.signInWithCredential).toHaveBeenCalledWith(sdk.auth, { token: 'id-token' });
    await store.signInWithGoogle(null);
    expect(auth.signInWithPopup).toHaveBeenCalledWith(sdk.auth, expect.any(auth.GoogleAuthProvider));
    await store.signOut();
    expect(auth.signOut).toHaveBeenCalledWith(sdk.auth);
    sdk.auth.currentUser = { uid: 'cal' };
    await store.deleteUser();
    expect(auth.deleteUser).toHaveBeenCalledWith({ uid: 'cal' });
  });

  it('reads, starts and watches BudgetMint’s epoch (the server’s word only)', async () => {
    const store = await createFirebaseStore(CONFIG);
    vi.mocked(fs.getDoc).mockResolvedValueOnce({ exists: () => true, get: () => 3 } as never);
    expect(await store.account('cal')).toBe(3);
    expect(fs.getDoc).toHaveBeenCalledWith({ path: 'budgetmint/cal' });
    vi.mocked(fs.getDoc).mockResolvedValueOnce({ exists: () => false, get: () => undefined } as never);
    expect(await store.account('cal')).toBeNull();
    expect(await store.createAccount('cal')).toBe(1);
    expect(fs.setDoc).toHaveBeenCalledWith({ path: 'budgetmint/cal' }, { epoch: 1 });

    const epochs: unknown[] = [];
    const failed = vi.fn();
    store.watchAccount('cal', epoch => epochs.push(epoch), failed);
    const [ref, onAccount, onError] = vi.mocked(fs.onSnapshot).mock.calls[0] as unknown as [
      unknown,
      (snapshot: unknown) => void,
      (error: unknown) => void,
    ];
    expect(ref).toEqual({ path: 'budgetmint/cal' });
    onAccount({ exists: () => true, get: () => 2, metadata: metadata(true) });
    onAccount({ exists: () => true, get: () => 2, metadata: metadata() });
    onAccount({ exists: () => false, get: () => undefined, metadata: metadata() });
    expect(epochs).toEqual([2, null]);
    onError('boom');
    expect(failed).toHaveBeenCalledWith('boom');
  });

  it('listens to the settings, the items and the occurrences from a date', async () => {
    const store = await createFirebaseStore(CONFIG);
    const snapshots: unknown[] = [];
    const stop = vi.fn();
    vi.mocked(fs.onSnapshot).mockReturnValue(stop as never);
    const unsubscribe = store.listen('cal', '2025-10-06', snapshot => snapshots.push(snapshot), vi.fn());
    const calls = vi.mocked(fs.onSnapshot).mock.calls as unknown as [unknown, unknown, (snapshot: unknown) => void][];
    expect(calls[0][0]).toEqual({ path: 'budgetmint/cal/data/settings~account' });
    expect(calls[0][1]).toEqual({ includeMetadataChanges: true });
    expect(calls[1][0]).toEqual({
      ref: { path: 'budgetmint/cal/data' },
      constraints: [
        ['where', '__id__', '>=', 'item~'],
        ['where', '__id__', '<=', 'item~'],
      ],
    });
    expect(calls[2][0]).toEqual({
      ref: { path: 'budgetmint/cal/data' },
      constraints: [
        ['where', '__id__', '>=', 'occ~2025-10-06'],
        ['where', '__id__', '<=', 'occ~'],
      ],
    });

    const fields = (json: unknown, schema: unknown) => (field: string) => ({ json, schema })[field];
    calls[0][2]({ id: 'settings~account', get: fields('{}', 1), metadata: metadata(true, false) });
    calls[0][2]({ id: 'settings~account', get: fields(undefined, undefined), metadata: metadata() });
    calls[1][2]({
      docChanges: () => [
        { type: 'added', doc: { id: 'item~rent', get: fields('{"a":1}', 2) } },
        { type: 'removed', doc: { id: 'item~old', get: fields('{"b":1}', 1) } },
      ],
      metadata: metadata(false, true),
    });
    expect(snapshots).toEqual([
      {
        source: 'settings',
        docs: [{ docId: 'settings~account', json: '{}', schema: 1 }],
        fromCache: true,
        pendingWrites: false,
      },
      {
        source: 'settings',
        docs: [{ docId: 'settings~account', json: null, schema: 1 }],
        fromCache: false,
        pendingWrites: false,
      },
      {
        source: 'items',
        docs: [
          { docId: 'item~rent', json: '{"a":1}', schema: 2 },
          { docId: 'item~old', json: null, schema: 1 },
        ],
        fromCache: false,
        pendingWrites: true,
      },
    ]);
    unsubscribe();
    expect(stop).toHaveBeenCalledTimes(3);
  });

  it('watches TaskMint’s forecast', async () => {
    const store = await createFirebaseStore(CONFIG);
    const docs: unknown[] = [];
    const failed = vi.fn();
    store.watchForecast('cal', doc => docs.push(doc), failed);
    const [ref, onForecast, onError] = vi.mocked(fs.onSnapshot).mock.calls[0] as unknown as [
      unknown,
      (snapshot: unknown) => void,
      (error: unknown) => void,
    ];
    expect(ref).toEqual({ path: 'users/cal/published/payoutForecast' });
    const fields = (values: Record<string, unknown>) => ({ exists: () => true, get: (field: string) => values[field] });
    onForecast(fields({ json: '{}', schema: 1, appVersion: '4.2.0', updatedAt: { toMillis: () => 5 } }));
    onForecast(fields({ json: '{}', schema: 2, updatedAt: null }));
    onForecast({ exists: () => false });
    expect(docs).toEqual([
      { json: '{}', schema: 1, appVersion: '4.2.0', updatedAtMs: 5 },
      { json: '{}', schema: 2, appVersion: null, updatedAtMs: null },
      null,
    ]);
    onError('denied');
    expect(failed).toHaveBeenCalledWith('denied');
  });

  it('writes and deletes core’s documents with what the rules want, a batch at a time', async () => {
    const store = await createFirebaseStore(CONFIG);
    const writes = Array.from({ length: BATCH_SIZE + 1 }, (_, i) => ({
      docId: `item~${i}`,
      kind: 'item',
      json: i === 0 ? null : '{}',
      schema: 1,
    }));
    await store.write('cal', writes, { deviceId: 'desk', epoch: 2 });
    expect(sdk.batch.commit).toHaveBeenCalledTimes(2);
    expect(sdk.batch.delete).toHaveBeenCalledWith({ path: 'budgetmint/cal/data/item~0' });
    expect(sdk.batch.set).toHaveBeenCalledWith(
      { path: 'budgetmint/cal/data/item~1' },
      { kind: 'item', json: '{}', schema: 1, deviceId: 'desk', epoch: 2, updatedAt: 'SERVER_TIME' }
    );
  });

  it('deletes everything on a new epoch', async () => {
    const store = await createFirebaseStore(CONFIG);
    const all = Array.from({ length: BATCH_SIZE + 2 }, (_, i) => ({ ref: `ref${i}` }));
    vi.mocked(fs.getDocs).mockResolvedValueOnce({ docs: all } as never);
    expect(await store.deleteAll('cal', 4)).toBe(5);
    expect(fs.updateDoc).toHaveBeenCalledWith({ path: 'budgetmint/cal' }, { epoch: 5 });
    expect(sdk.batch.delete).toHaveBeenCalledTimes(BATCH_SIZE + 2);
    expect(sdk.batch.commit).toHaveBeenCalledTimes(2);
  });

  it('asks whether TaskMint uses the account', async () => {
    const store = await createFirebaseStore(CONFIG);
    vi.mocked(fs.getDocs).mockResolvedValueOnce({ empty: false } as never);
    expect(await store.hasTaskMintData('cal')).toBe(true);
    expect(fs.query).toHaveBeenLastCalledWith(
      { path: 'users/cal/data' },
      ['where', 'deleted', '==', false],
      ['limit', 1]
    );
    vi.mocked(fs.getDocs).mockResolvedValueOnce({ empty: true } as never);
    expect(await store.hasTaskMintData('cal')).toBe(false);
  });
});
