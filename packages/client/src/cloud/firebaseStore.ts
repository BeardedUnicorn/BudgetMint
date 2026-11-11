/**
 * The BudgetStore on Firebase's JavaScript SDK, loaded only once the app
 * starts (it's a large part of the bundle). Sign-in keeps the session in
 * the webview's IndexedDB (falling back to localStorage); the apps' webviews
 * pass no popup resolver, so nothing loads Google's sign-in iframe there.
 * Firestore's cache holds the account's data on the device, and its
 * unsent writes, so the app opens and works offline.
 */

import type { DocWrite, ForecastDoc, IncomingDoc } from '@budgetmint/contracts';
import type { BudgetStore, CloudConfig, CloudUser, DocsSource, WriteMeta } from './types';

/** Firestore takes at most 500 writes in a batch. */
export const BATCH_SIZE = 400;

/** Firebase deletes an account within five minutes of signing in: a minute less, for the deleting. */
export const RECENT_SIGN_IN_MS = 4 * 60_000;

/** Where BudgetMint keeps its data, and where TaskMint publishes its forecast. */
export const ROOT = 'budgetmint';
export const FORECAST_PATH = ['published', 'payoutForecast'] as const;

/** The highest character a document id range can end on. */
const LAST = '';

export async function createFirebaseStore(config: CloudConfig): Promise<BudgetStore> {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
  ]);
  // The emulators' data gets an app (and a cache) of its own
  const app = initializeApp(config.firebase, config.emulatorHost ? 'emulator' : undefined);
  const session = auth.initializeAuth(app, {
    persistence: [auth.indexedDBLocalPersistence, auth.browserLocalPersistence],
    ...(config.popupSignIn ? { popupRedirectResolver: auth.browserPopupRedirectResolver } : {}),
  });
  const localCache = {
    tabs: () => fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    single: () => fs.persistentLocalCache({ tabManager: fs.persistentSingleTabManager({}) }),
    memory: () => fs.memoryLocalCache(),
  }[config.cache]();
  const db = fs.initializeFirestore(app, { localCache });
  if (config.emulatorHost) {
    auth.connectAuthEmulator(session, `http://${config.emulatorHost}:9099`, { disableWarnings: true });
    fs.connectFirestoreEmulator(db, config.emulatorHost, 8085);
  }

  const accountDoc = (uid: string) => fs.doc(db, ROOT, uid);
  const data = (uid: string) => fs.collection(db, ROOT, uid, 'data');
  const epochOf = (snapshot: { exists(): boolean; get(field: string): unknown }) =>
    snapshot.exists() ? Number(snapshot.get('epoch')) : null;
  /** The documents whose ids run from `from` to the end of `prefix`'s. */
  const range = (uid: string, from: string, prefix: string) =>
    fs.query(data(uid), fs.where(fs.documentId(), '>=', from), fs.where(fs.documentId(), '<=', `${prefix}${LAST}`));
  const incoming = (id: string, json: unknown, schema: unknown): IncomingDoc => ({
    docId: id,
    json: typeof json === 'string' ? json : null,
    schema: Number(schema ?? 1),
  });
  /**
   * Commits `fill`'s writes a batch at a time, every batch at once: offline,
   * Firestore keeps each until it can send it (one awaited before the next
   * was queued would leave the rest unsent), and it sends them in order.
   */
  const inBatches = <T>(items: T[], fill: (batch: ReturnType<typeof fs.writeBatch>, item: T) => void) => {
    const commits: Promise<void>[] = [];
    for (let start = 0; start < items.length; start += BATCH_SIZE) {
      const batch = fs.writeBatch(db);
      for (const item of items.slice(start, start + BATCH_SIZE)) fill(batch, item);
      commits.push(batch.commit());
    }
    return Promise.all(commits);
  };
  type Ref = ReturnType<typeof fs.doc>;
  const deleteRefs = (refs: Ref[]) => inBatches(refs, (batch, ref) => batch.delete(ref));

  return {
    onUser(listener) {
      return auth.onAuthStateChanged(session, user =>
        listener(
          user
            ? ({
                uid: user.uid,
                email: user.email,
                providers: user.providerData.map(provider => provider.providerId),
              } satisfies CloudUser)
            : null
        )
      );
    },
    async signIn(email, password) {
      await auth.signInWithEmailAndPassword(session, email, password);
    },
    async signUp(email, password) {
      await auth.createUserWithEmailAndPassword(session, email, password);
    },
    resetPassword: email => auth.sendPasswordResetEmail(session, email),
    async signInWithGoogle(idToken) {
      await (idToken
        ? auth.signInWithCredential(session, auth.GoogleAuthProvider.credential(idToken))
        : auth.signInWithPopup(session, new auth.GoogleAuthProvider()));
    },
    signOut: () => auth.signOut(session),
    async deleteUser() {
      await auth.deleteUser(session.currentUser!);
    },
    async signedInRecently() {
      const { authTime } = await session.currentUser!.getIdTokenResult();
      return Date.now() - Date.parse(authTime) < RECENT_SIGN_IN_MS;
    },

    account: async uid => epochOf(await fs.getDoc(accountDoc(uid))),
    async createAccount(uid) {
      await fs.setDoc(accountDoc(uid), { epoch: 1 });
      return 1;
    },
    watchAccount(uid, listener, onError) {
      return fs.onSnapshot(
        accountDoc(uid),
        snapshot => {
          // Only the server's word: a cached copy may be from before a reset
          if (!snapshot.metadata.fromCache) listener(epochOf(snapshot));
        },
        onError
      );
    },

    listen(uid, epoch, occurrencesFrom, onDocs, onError) {
      const report = (
        source: DocsSource,
        docs: IncomingDoc[],
        metadata: { fromCache: boolean; hasPendingWrites: boolean }
      ) => onDocs({ source, docs, fromCache: metadata.fromCache, pendingWrites: metadata.hasPendingWrites });
      /**
       * A document from an epoch before this one outlived a delete cut short
       * (here or on another device): it reads as deleted, and is deleted
       * again. Tried again at every start, so a failure here is let go.
       */
      const read = (doc: { id: string; ref: Ref; get(field: string): unknown }, leftovers: Ref[]) => {
        if (Number(doc.get('epoch')) < epoch) {
          leftovers.push(doc.ref);
          return incoming(doc.id, null, doc.get('schema'));
        }
        return incoming(doc.id, doc.get('json'), doc.get('schema'));
      };
      const sweep = (leftovers: Ref[]) => {
        if (leftovers.length > 0) void deleteRefs(leftovers).catch(() => undefined);
      };
      const sets = [
        ['items', range(uid, 'item~', 'item~')],
        ['occurrences', range(uid, `occ~${occurrencesFrom}`, 'occ~')],
      ] as const;
      const unsubscribe = [
        fs.onSnapshot(
          fs.doc(data(uid), 'settings~account'),
          { includeMetadataChanges: true },
          snapshot => {
            const leftovers: Ref[] = [];
            report('settings', [read(snapshot, leftovers)], snapshot.metadata);
            sweep(leftovers);
          },
          onError
        ),
        ...sets.map(([source, query]) =>
          fs.onSnapshot(
            query,
            { includeMetadataChanges: true },
            snapshot => {
              const leftovers: Ref[] = [];
              report(
                source,
                snapshot
                  .docChanges()
                  .map(({ type, doc }) =>
                    type === 'removed' ? incoming(doc.id, null, doc.get('schema')) : read(doc, leftovers)
                  ),
                snapshot.metadata
              );
              sweep(leftovers);
            },
            onError
          )
        ),
      ];
      return () => {
        for (const stop of unsubscribe) stop();
      };
    },
    watchForecast(uid, listener, onError) {
      return fs.onSnapshot(
        fs.doc(db, 'users', uid, ...FORECAST_PATH),
        snapshot => {
          if (!snapshot.exists()) {
            listener(null);
            return;
          }
          const updated = snapshot.get('updatedAt') as { toMillis(): number } | null;
          listener({
            json: String(snapshot.get('json')),
            schema: Number(snapshot.get('schema')),
            appVersion: (snapshot.get('appVersion') as string | undefined) ?? null,
            updatedAtMs: updated ? updated.toMillis() : null,
          } satisfies ForecastDoc);
        },
        onError
      );
    },

    async write(uid, writes: DocWrite[], meta: WriteMeta) {
      await inBatches(writes, (batch, write) => {
        const ref = fs.doc(data(uid), write.docId);
        if (write.json === null) {
          batch.delete(ref);
        } else {
          batch.set(ref, {
            kind: write.kind,
            json: write.json,
            schema: write.schema,
            deviceId: meta.deviceId,
            epoch: meta.epoch,
            updatedAt: fs.serverTimestamp(),
          });
        }
      });
    },
    async deleteAll(uid, epoch) {
      const next = epoch + 1;
      // Writes from devices still on the old epoch are refused from here on,
      // and what's left of the old one reads as deleted (listen) if this is cut short
      await fs.updateDoc(accountDoc(uid), { epoch: next });
      const all = await fs.getDocs(data(uid));
      await deleteRefs(all.docs.map(doc => doc.ref));
      return next;
    },
    async hasTaskMintData(uid) {
      const taskmint = fs.collection(db, 'users', uid, 'data');
      const live = await fs.getDocs(fs.query(taskmint, fs.where('deleted', '==', false), fs.limit(1)));
      return !live.empty;
    },
  };
}
