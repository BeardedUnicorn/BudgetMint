// Adapted from TaskMint packages/client/src/cloud/__tests__/firebaseStore.test.ts @ 1623bee.
import { describe, expect, it, vi } from 'vitest';
import type { CloudConfig } from '../types';

// The SDK, as far as the store uses it: each call recorded, and each app's
// Auth and Firestore told apart by the app's name
const sdk = vi.hoisted(() => {
  const batch = { set: vi.fn(), delete: vi.fn(), commit: vi.fn(async () => undefined) };
  return {
    batch,
    auths: {} as Record<string, { app: string; currentUser?: unknown }>,
    dbs: {} as Record<string, { app: string }>,
    authListeners: new Map<unknown, (user: unknown) => void>(),
  };
});

vi.mock('firebase/app', () => ({ initializeApp: vi.fn((_config, name) => ({ name: name ?? '[DEFAULT]' })) }));
vi.mock('firebase/auth', () => {
  const GoogleAuthProvider = Object.assign(
    vi.fn(function GoogleAuthProvider() {}),
    {
      credential: vi.fn((token: string) => ({ token })),
      credentialFromResult: vi.fn((result: { credential?: unknown }) => result.credential ?? null),
    }
  );
  return {
    initializeAuth: vi.fn((app: { name: string }) => (sdk.auths[app.name] ??= { app: app.name })),
    indexedDBLocalPersistence: 'indexedDB',
    browserLocalPersistence: 'local',
    browserPopupRedirectResolver: 'popups',
    connectAuthEmulator: vi.fn(),
    onAuthStateChanged: vi.fn((auth, listener) => {
      sdk.authListeners.set(auth, listener);
      return () => undefined;
    }),
    signInWithEmailAndPassword: vi.fn(async () => ({})),
    createUserWithEmailAndPassword: vi.fn(async () => ({})),
    sendPasswordResetEmail: vi.fn(async () => undefined),
    signInWithCredential: vi.fn(async () => ({})),
    signInWithPopup: vi.fn(async () => ({})),
    getAdditionalUserInfo: vi.fn((result: { info?: unknown }) => result.info ?? null),
    signOut: vi.fn(async () => undefined),
    deleteUser: vi.fn(async () => undefined),
    GoogleAuthProvider,
  };
});
vi.mock('firebase/firestore', () => ({
  initializeFirestore: vi.fn((app: { name: string }) => (sdk.dbs[app.name] ??= { app: app.name })),
  memoryLocalCache: vi.fn(() => 'memory'),
  persistentLocalCache: vi.fn(options => ({ persistent: options })),
  persistentMultipleTabManager: vi.fn(() => 'tabs'),
  persistentSingleTabManager: vi.fn(() => 'single'),
  connectFirestoreEmulator: vi.fn(),
  terminate: vi.fn(async () => undefined),
  clearIndexedDbPersistence: vi.fn(async () => undefined),
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
  writeBatch: vi.fn(() => sdk.batch),
  serverTimestamp: vi.fn(() => 'SERVER_TIME'),
}));

const auth = await import('firebase/auth');
const app = await import('firebase/app');
const fs = await import('firebase/firestore');
const { BATCH_SIZE, createFirebaseStore } = await import('../firebaseStore');
const { NO_TASKMINT_ACCOUNT } = await import('../errors');

const CONFIG: CloudConfig = {
  firebase: {
    apiKey: 'key',
    authDomain: 'example.firebaseapp.com',
    projectId: 'example',
    storageBucket: 'example.appspot.com',
    messagingSenderId: '1',
    appId: 'app',
  },
  taskmint: {
    apiKey: 'taskmint-key',
    authDomain: 'taskmint.firebaseapp.com',
    projectId: 'taskmint',
    storageBucket: 'taskmint.appspot.com',
    messagingSenderId: '2',
    appId: 'taskmint-app',
  },
  cache: 'memory',
  popupSignIn: false,
};

/** BudgetMint's own Auth, and TaskMint's. */
const budgetmint = () => sdk.auths['[DEFAULT]'];
const taskmint = () => sdk.auths.taskmint;

const metadata = (fromCache = false, hasPendingWrites = false) => ({ fromCache, hasPendingWrites });

describe('the Firebase store', () => {
  it('keeps Firestore’s caches as the shell asks, and the emulators’ apart', async () => {
    await createFirebaseStore(CONFIG);
    expect(auth.initializeAuth).toHaveBeenCalledWith(expect.anything(), { persistence: ['indexedDB', 'local'] });
    expect(fs.initializeFirestore).toHaveBeenLastCalledWith(expect.anything(), { localCache: 'memory' });
    // BudgetMint's project in the default app, TaskMint's in its own
    expect(vi.mocked(app.initializeApp).mock.calls).toEqual([
      [CONFIG.firebase, undefined],
      [CONFIG.taskmint, 'taskmint'],
    ]);
    expect(auth.connectAuthEmulator).not.toHaveBeenCalled();

    await createFirebaseStore({ ...CONFIG, cache: 'single' });
    expect(fs.initializeFirestore).toHaveBeenLastCalledWith(expect.anything(), {
      localCache: { persistent: { tabManager: 'single' } },
    });
    vi.mocked(app.initializeApp).mockClear();
    await createFirebaseStore({ ...CONFIG, cache: 'tabs', popupSignIn: true, emulatorHost: '10.0.2.2' });
    expect(fs.initializeFirestore).toHaveBeenLastCalledWith(expect.anything(), {
      localCache: { persistent: { tabManager: 'tabs' } },
    });
    expect(auth.initializeAuth).toHaveBeenLastCalledWith(expect.anything(), {
      persistence: ['indexedDB', 'local'],
      popupRedirectResolver: 'popups',
    });
    expect(vi.mocked(app.initializeApp).mock.calls).toEqual([
      [CONFIG.firebase, 'emulator'],
      [CONFIG.taskmint, 'taskmint-emulator'],
    ]);
    for (const name of ['emulator', 'taskmint-emulator']) {
      expect(auth.connectAuthEmulator).toHaveBeenCalledWith(sdk.auths[name], 'http://10.0.2.2:9099', {
        disableWarnings: true,
      });
      expect(fs.connectFirestoreEmulator).toHaveBeenCalledWith(sdk.dbs[name], '10.0.2.2', 8085);
    }
  });

  it('reports the signed-in user, and signs in and out of both every way', async () => {
    const store = await createFirebaseStore(CONFIG);
    const users: unknown[] = [];
    store.onUser(user => users.push(user));
    const told = sdk.authListeners.get(budgetmint())!;
    told({ uid: 'cal', email: 'cal@example.com', providerData: [{ providerId: 'password' }] });
    told(null);
    expect(users).toEqual([{ uid: 'cal', email: 'cal@example.com', providers: ['password'] }, null]);

    // Email: TaskMint with the same, and BudgetMint signs in all the same when TaskMint won't
    await store.signIn('cal@example.com', 'pw');
    expect(vi.mocked(auth.signInWithEmailAndPassword).mock.calls).toEqual([
      [budgetmint(), 'cal@example.com', 'pw'],
      [taskmint(), 'cal@example.com', 'pw'],
    ]);
    vi.mocked(auth.signInWithEmailAndPassword).mockResolvedValueOnce({} as never);
    vi.mocked(auth.signInWithEmailAndPassword).mockRejectedValueOnce({ code: 'auth/invalid-credential' });
    await store.signIn('cal@example.com', 'pw');
    // A new account is BudgetMint's only
    await store.signUp('dee@example.com', 'pw2');
    expect(auth.createUserWithEmailAndPassword).toHaveBeenCalledWith(budgetmint(), 'dee@example.com', 'pw2');
    expect(auth.createUserWithEmailAndPassword).toHaveBeenCalledTimes(1);
    expect(auth.signInWithEmailAndPassword).toHaveBeenLastCalledWith(taskmint(), 'dee@example.com', 'pw2');
    await store.resetPassword('cal@example.com');
    expect(auth.sendPasswordResetEmail).toHaveBeenCalledWith(budgetmint(), 'cal@example.com');
    await store.signOut();
    expect(vi.mocked(auth.signOut).mock.calls).toEqual([[budgetmint()], [taskmint()]]);

    const signedInAt = (ms: number) => ({ authTime: new Date(Date.now() - ms).toUTCString() });
    const getIdTokenResult = vi.fn(async () => signedInAt(60_000));
    budgetmint().currentUser = { uid: 'cal', getIdTokenResult };
    vi.mocked(auth.signOut).mockClear();
    await store.deleteUser();
    // BudgetMint's account; TaskMint's is only signed out of
    expect(auth.deleteUser).toHaveBeenCalledWith(budgetmint().currentUser);
    expect(vi.mocked(auth.signOut).mock.calls).toEqual([[taskmint()]]);
    // A minute ago is recent enough to delete the account; ten aren't
    expect(await store.signedInRecently()).toBe(true);
    getIdTokenResult.mockResolvedValueOnce(signedInAt(10 * 60_000));
    expect(await store.signedInRecently()).toBe(false);
  });

  it('erases both projects’ caches on this device, and goes on past one it can’t', async () => {
    const store = await createFirebaseStore(CONFIG);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await store.clearDevice();
    expect(vi.mocked(fs.terminate).mock.calls).toEqual([[sdk.dbs['[DEFAULT]']], [sdk.dbs.taskmint]]);
    expect(vi.mocked(fs.clearIndexedDbPersistence).mock.calls).toEqual([[sdk.dbs['[DEFAULT]']], [sdk.dbs.taskmint]]);
    expect(warn).not.toHaveBeenCalled();

    // Another tab still has BudgetMint's open: TaskMint's is erased all the same
    vi.mocked(fs.clearIndexedDbPersistence).mockRejectedValueOnce({ code: 'failed-precondition' });
    await store.clearDevice();
    expect(warn).toHaveBeenCalledOnce();
    expect(fs.clearIndexedDbPersistence).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });

  it('signs in to TaskMint with the same Google account, and makes no TaskMint account doing it', async () => {
    const store = await createFirebaseStore(CONFIG);
    // The shell's token, for both
    await store.signInWithGoogle('id-token');
    expect(vi.mocked(auth.signInWithCredential).mock.calls).toEqual([
      [budgetmint(), { token: 'id-token' }],
      [taskmint(), { token: 'id-token' }],
    ]);

    // The popup's credential, for TaskMint
    vi.mocked(auth.signInWithCredential).mockClear();
    vi.mocked(auth.signInWithPopup).mockResolvedValueOnce({ credential: { token: 'popup' } } as never);
    await store.signInWithGoogle(null);
    expect(auth.signInWithPopup).toHaveBeenCalledWith(budgetmint(), expect.any(auth.GoogleAuthProvider));
    expect(vi.mocked(auth.signInWithCredential).mock.calls).toEqual([[taskmint(), { token: 'popup' }]]);
    // A popup that gave none: BudgetMint alone
    vi.mocked(auth.signInWithCredential).mockClear();
    await store.signInWithGoogle(null);
    expect(auth.signInWithCredential).not.toHaveBeenCalled();

    // TaskMint had no account for it: the one just made is deleted again, and BudgetMint is signed in
    vi.mocked(auth.signInWithCredential).mockResolvedValueOnce({} as never);
    vi.mocked(auth.signInWithCredential).mockResolvedValueOnce({ user: 'made', info: { isNewUser: true } } as never);
    await store.signInWithGoogle('id-token');
    expect(auth.deleteUser).toHaveBeenCalledWith('made');
  });

  it('signs in to TaskMint alone, and out of it', async () => {
    const store = await createFirebaseStore(CONFIG);
    const users: unknown[] = [];
    store.onTaskMint(user => users.push(user));
    const told = sdk.authListeners.get(taskmint())!;
    told({ uid: 'tm', email: 'cal@example.com', providerData: [{ providerId: 'google.com' }] });
    told(null);
    expect(users).toEqual([{ uid: 'tm', email: 'cal@example.com', providers: ['google.com'] }, null]);

    await store.signInToTaskMint('cal@example.com', 'other');
    expect(auth.signInWithEmailAndPassword).toHaveBeenCalledWith(taskmint(), 'cal@example.com', 'other');
    await store.signInToTaskMintWithGoogle('id-token');
    expect(auth.signInWithCredential).toHaveBeenCalledWith(taskmint(), { token: 'id-token' });
    await store.signInToTaskMintWithGoogle(null);
    expect(auth.signInWithPopup).toHaveBeenCalledWith(taskmint(), expect.any(auth.GoogleAuthProvider));
    expect(vi.mocked(auth.signInWithEmailAndPassword).mock.calls.every(([on]) => (on as unknown) === taskmint())).toBe(
      true
    );

    // A Google account TaskMint doesn't have: none is left made, and it says why
    vi.mocked(auth.signInWithPopup).mockResolvedValueOnce({ user: 'made', info: { isNewUser: true } } as never);
    await expect(store.signInToTaskMintWithGoogle(null)).rejects.toMatchObject({ code: NO_TASKMINT_ACCOUNT });
    expect(auth.deleteUser).toHaveBeenCalledWith('made');

    await store.signOutOfTaskMint();
    expect(vi.mocked(auth.signOut).mock.calls).toEqual([[taskmint()]]);
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
    const unsubscribe = store.listen('cal', 3, '2025-10-06', snapshot => snapshots.push(snapshot), vi.fn());
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

    const fields =
      (json: unknown, schema: unknown, epoch: unknown = 3) =>
      (field: string) =>
        ({ json, schema, epoch })[field];
    calls[0][2]({ id: 'settings~account', get: fields('{}', 1), metadata: metadata(true, false) });
    calls[0][2]({ id: 'settings~account', get: fields(undefined, undefined), metadata: metadata() });
    calls[1][2]({
      docChanges: () => [
        { type: 'added', doc: { id: 'item~rent', get: fields('{"a":1}', 2) } },
        { type: 'removed', doc: { id: 'item~old', get: fields('{"b":1}', 1) } },
      ],
      metadata: metadata(false, true),
    });
    expect(sdk.batch.delete).not.toHaveBeenCalled();
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

  it('reads what a delete cut short left as deleted, and deletes it again', async () => {
    const store = await createFirebaseStore(CONFIG);
    const snapshots: { docs: unknown[] }[] = [];
    store.listen('cal', 3, '2025-10-06', snapshot => snapshots.push(snapshot), vi.fn());
    const calls = vi.mocked(fs.onSnapshot).mock.calls as unknown as [unknown, unknown, (snapshot: unknown) => void][];
    const doc = (id: string, epoch: number) => ({
      id,
      ref: { path: id },
      get: (field: string) => ({ json: '{}', schema: 1, epoch })[field],
    });
    calls[0][2]({ ...doc('settings~account', 2), metadata: metadata() });
    // The deleting fails: let go, and tried again at the next start
    sdk.batch.commit.mockRejectedValueOnce(new Error('offline'));
    calls[1][2]({
      docChanges: () => [
        { type: 'added', doc: doc('item~old', 1) },
        { type: 'modified', doc: doc('item~new', 3) },
      ],
      metadata: metadata(),
    });
    expect(snapshots.map(snapshot => snapshot.docs)).toEqual([
      [{ docId: 'settings~account', json: null, schema: 1 }],
      [
        { docId: 'item~old', json: null, schema: 1 },
        { docId: 'item~new', json: '{}', schema: 1 },
      ],
    ]);
    expect(sdk.batch.delete.mock.calls).toEqual([[{ path: 'settings~account' }], [{ path: 'item~old' }]]);
    expect(sdk.batch.commit).toHaveBeenCalledTimes(2);
    await Promise.resolve();
  });

  it('watches TaskMint’s forecast, in TaskMint’s project', async () => {
    const store = await createFirebaseStore(CONFIG);
    const docs: unknown[] = [];
    const failed = vi.fn();
    store.watchForecast('cal', doc => docs.push(doc), failed);
    expect(fs.doc).toHaveBeenCalledWith(sdk.dbs.taskmint, 'users', 'cal', 'published', 'payoutForecast');
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
    // Each batch is queued before any is answered (offline, none is)
    let answer: () => void = () => undefined;
    sdk.batch.commit.mockImplementationOnce(
      () => new Promise<undefined>(resolve => (answer = () => resolve(undefined)))
    );
    const written = store.write('cal', writes, { deviceId: 'desk', epoch: 2 });
    expect(sdk.batch.commit).toHaveBeenCalledTimes(2);
    answer();
    await written;
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
});
