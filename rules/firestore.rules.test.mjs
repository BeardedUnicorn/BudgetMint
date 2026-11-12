// Adapted from TaskMint firebase/firestore.rules.test.mjs @ fc8bb41 (its BudgetMint cases).
// BudgetMint's Firestore rules (firestore.rules), on the emulator:
// scripts/test-emulator.sh starts it and runs this file.

import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, setLogLevel, Timestamp, updateDoc } from 'firebase/firestore';

let env;

before(async () => {
  // The refused writes are the point; their warnings aren't
  setLogLevel('silent');
  env = await initializeTestEnvironment({
    // Apart from the store's emulator tests, which run in the same emulator
    projectId: 'demo-budgetmint-rules',
    firestore: {
      rules: readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8085,
    },
  });
});

after(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  // bea's account, on its first epoch
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'budgetmint/bea'), { epoch: 1 }));
});

const bea = () => env.authenticatedContext('bea').firestore();
const cal = () => env.authenticatedContext('cal').firestore();
const nobody = () => env.unauthenticatedContext().firestore();

/** A document as BudgetMint writes it. */
function budget(changes = {}) {
  return {
    kind: 'item',
    json: '{"id":"rent"}',
    schema: 1,
    deviceId: 'desk',
    epoch: 1,
    updatedAt: serverTimestamp(),
    ...changes,
  };
}

const ITEM = 'budgetmint/bea/data/item~2f1c6a0e-4b7d-4a8e-9a51-0f6f3c2b9d10';

describe('the account document', () => {
  it('is its owner’s alone, starts on epoch 1 and moves on one at a time', async () => {
    await assertSucceeds(getDoc(doc(bea(), 'budgetmint/bea')));
    await assertFails(getDoc(doc(cal(), 'budgetmint/bea')));
    await assertFails(getDoc(doc(nobody(), 'budgetmint/bea')));
    await assertFails(setDoc(doc(cal(), 'budgetmint/bea'), { epoch: 2 }));
    await assertFails(setDoc(doc(cal(), 'budgetmint/cal'), { epoch: 2 }));
    await assertFails(setDoc(doc(cal(), 'budgetmint/cal'), { epoch: 1, admin: true }));
    await assertSucceeds(setDoc(doc(cal(), 'budgetmint/cal'), { epoch: 1 }));
    await assertFails(updateDoc(doc(bea(), 'budgetmint/bea'), { epoch: 3 }));
    await assertSucceeds(updateDoc(doc(bea(), 'budgetmint/bea'), { epoch: 2 }));
    await assertFails(updateDoc(doc(bea(), 'budgetmint/bea'), { epoch: 3, admin: true }));
    await assertSucceeds(deleteDoc(doc(bea(), 'budgetmint/bea')));
  });
});

describe('the data documents', () => {
  it('are written, read and deleted by their owner only', async () => {
    await assertSucceeds(setDoc(doc(bea(), ITEM), budget()));
    await assertSucceeds(getDoc(doc(bea(), ITEM)));
    await assertFails(getDoc(doc(cal(), ITEM)));
    await assertFails(getDoc(doc(nobody(), ITEM)));
    await assertFails(setDoc(doc(cal(), ITEM), budget()));
    await assertFails(deleteDoc(doc(cal(), ITEM)));
    await assertSucceeds(deleteDoc(doc(bea(), ITEM)));
  });

  it('are refused from an earlier epoch, or without an account', async () => {
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'budgetmint/bea'), { epoch: 2 }));
    await assertFails(setDoc(doc(bea(), ITEM), budget()));
    await assertSucceeds(setDoc(doc(bea(), ITEM), budget({ epoch: 2 })));
    await assertFails(setDoc(doc(cal(), 'budgetmint/cal/data/item~rent'), budget()));
  });

  it('have each kind’s ids and sizes', async () => {
    const allowed = [
      ['budgetmint/bea/data/settings~account', budget({ kind: 'settings', json: 'x'.repeat(20000) })],
      [ITEM, budget({ json: 'x'.repeat(50000) })],
      ['budgetmint/bea/data/occ~2026-11-30~rent-1', budget({ kind: 'occ', json: 'x'.repeat(4000) })],
    ];
    for (const [path, data] of allowed) {
      await assertSucceeds(setDoc(doc(bea(), path), data));
    }
    const refused = [
      ['budgetmint/bea/data/settings~device', budget({ kind: 'settings' })],
      ['budgetmint/bea/data/settings~account', budget({ kind: 'settings', json: 'x'.repeat(20001) })],
      [ITEM, budget({ json: 'x'.repeat(50001) })],
      ['budgetmint/bea/data/item~', budget()],
      ['budgetmint/bea/data/item~a b', budget()],
      [`budgetmint/bea/data/item~${'a'.repeat(65)}`, budget()],
      ['budgetmint/bea/data/occ~2026-11-30~rent-1', budget({ kind: 'occ', json: 'x'.repeat(4001) })],
      ['budgetmint/bea/data/occ~2026-11~rent-1', budget({ kind: 'occ' })],
      ['budgetmint/bea/data/occ~2026-11-30', budget({ kind: 'occ' })],
      // A kind under another kind's id
      ['budgetmint/bea/data/item~rent', budget({ kind: 'occ' })],
      ['budgetmint/bea/data/secret~x', budget({ kind: 'secret' })],
    ];
    for (const [path, data] of refused) {
      await assertFails(setDoc(doc(bea(), path), data));
    }
  });

  it('hold only what BudgetMint writes, as it writes it', async () => {
    const refused = [
      budget({ extra: 1 }),
      budget({ kind: 7 }),
      budget({ json: 42 }),
      budget({ schema: 0 }),
      budget({ schema: '1' }),
      budget({ deviceId: 'x'.repeat(65) }),
      budget({ updatedAt: Timestamp.fromMillis(0) }),
    ];
    for (const data of refused) {
      await assertFails(setDoc(doc(bea(), ITEM), data));
    }
    const { deviceId: _, ...missing } = budget();
    await assertFails(setDoc(doc(bea(), ITEM), missing));
  });

  it('can’t go back to an older schema', async () => {
    await assertSucceeds(setDoc(doc(bea(), ITEM), budget({ schema: 2 })));
    await assertFails(setDoc(doc(bea(), ITEM), budget({ schema: 1 })));
    // A goal with an amount set aside already is schema 3: a BudgetMint before it can't write it back as 2
    await assertSucceeds(setDoc(doc(bea(), ITEM), budget({ schema: 3 })));
    await assertFails(setDoc(doc(bea(), ITEM), budget({ schema: 2 })));
    await assertSucceeds(setDoc(doc(bea(), ITEM), budget({ schema: 3 })));
  });
});

describe('everything else', () => {
  it('is refused: the project holds BudgetMint’s data only', async () => {
    await assertFails(setDoc(doc(bea(), 'users/bea'), { epoch: 1 }));
    await assertFails(getDoc(doc(bea(), 'users/bea/published/payoutForecast')));
    await assertFails(setDoc(doc(bea(), 'budgetmint/bea/other/x'), budget()));
  });
});
