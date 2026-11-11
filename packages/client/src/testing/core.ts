/**
 * The real core for tests: budgetmint-core's wasm (scripts/build-wasm.mjs
 * builds it), loaded from its bytes, at a time the test sets.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Core, initSync } from '../core/wasm/budgetmint_core';
import { coreClient, type CoreClient } from '../core';

let loaded = false;

/** The wasm's bytes (the tests run in packages/client). */
export function wasmBytes(): Buffer {
  return readFileSync(join(process.cwd(), 'src/core/wasm/budgetmint_core_bg.wasm'));
}

/** Nov 10, 2026, noon in Chicago: the tests' usual now. */
export const TEST_NOW = Date.UTC(2026, 10, 10, 18, 0);

/** A fresh core in `zone`, at `clock()`'s time. */
export function testCore(clock: () => number = () => TEST_NOW, zone = 'America/Chicago'): CoreClient {
  if (!loaded) {
    initSync({ module: wasmBytes() });
    loaded = true;
  }
  return coreClient(new Core(zone), clock);
}
