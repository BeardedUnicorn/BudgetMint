/**
 * BudgetMint's rules (crates/budgetmint-core), in WebAssembly in this
 * webview: every page asks them what to show, and they plan every change.
 * Calls are synchronous and typed by @budgetmint/contracts; a refusal
 * throws an Error with the message to show.
 */

import type { CommandArgs, CommandName, CommandReply } from '@budgetmint/contracts';
import init, { Core, type InitInput } from './wasm/budgetmint_core';

export type CoreArgs<K extends CommandName> = CommandArgs<K> extends void ? [] : [CommandArgs<K>];

export interface CoreClient {
  call<K extends CommandName>(command: K, ...args: CoreArgs<K>): CommandReply<K>;
  /** The user is in another time zone now. */
  setZone(zone: string): void;
}

/** This device's IANA time zone. */
export function deviceZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Core over a loaded wasm `Core`, with the time from `clock`. */
export function coreClient(core: Pick<Core, 'call' | 'setZone'>, clock: () => number = Date.now): CoreClient {
  return {
    call(command, ...args) {
      let reply: string;
      try {
        reply = core.call(command, JSON.stringify(args[0] ?? {}), clock());
      } catch (message) {
        throw new Error(String(message));
      }
      return JSON.parse(reply);
    },
    setZone: zone => core.setZone(zone),
  };
}

let current: CoreClient | null = null;

/** Loads the wasm (`source`: its URL, or its bytes in tests) and starts core in `zone`. */
export async function loadCore(source: InitInput, zone = deviceZone()): Promise<CoreClient> {
  await init({ module_or_path: source });
  current = coreClient(new Core(zone));
  return current;
}

/** The loaded core (after loadCore). */
export function getCore(): CoreClient {
  if (!current) throw new Error('BudgetMint’s core hasn’t loaded');
  return current;
}

/** Tests: the core to use. */
export function setCoreForTest(core: CoreClient | null): void {
  current = core;
}
