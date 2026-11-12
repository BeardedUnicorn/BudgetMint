/**
 * BudgetMint's rules (crates/budgetmint-core), in WebAssembly in this
 * webview: every page asks them what to show, and they plan every change.
 * Calls are synchronous and typed by @budgetmint/contracts; a refusal
 * throws a CoreRefusal: the message to show, and the form's field it's
 * about when it's about one.
 */

import type { CommandArgs, CommandName, CommandReply, FormField, Refusal } from '@budgetmint/contracts';
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

/**
 * Core stopped (its WebAssembly trapped): nothing it holds can be trusted
 * any more, and every later call would fail too. Reloading starts it again
 * from what's saved.
 */
export class CoreStopped extends Error {
  constructor() {
    super(
      'BudgetMint ran into a problem it can’t carry on from. Reload to start it again: what you saved is still saved.'
    );
    this.name = 'CoreStopped';
  }
}

/** Core refused a command: `message` says why, and `field` (when it's about one) which of the form's fields. */
export class CoreRefusal extends Error {
  constructor(
    message: string,
    readonly field: FormField | null = null
  ) {
    super(message);
    this.name = 'CoreRefusal';
  }
}

/** Core's refusal (JSON: crates/budgetmint-core/src/error.rs's Refusal), as thrown. */
function refusal(thrown: unknown): CoreRefusal {
  const { message, field } = JSON.parse(String(thrown)) as Refusal;
  return new CoreRefusal(message, field);
}

/** Core over a loaded wasm `Core`, with the time from `clock`. */
export function coreClient(core: Pick<Core, 'call' | 'setZone'>, clock: () => number = Date.now): CoreClient {
  let stopped = false;
  return {
    call(command, ...args) {
      if (stopped) throw new CoreStopped();
      let reply: string;
      try {
        reply = core.call(command, JSON.stringify(args[0] ?? {}), clock());
      } catch (message) {
        if (message instanceof WebAssembly.RuntimeError) {
          stopped = true;
          console.error('BudgetMint’s core stopped:', message);
          throw new CoreStopped();
        }
        throw refusal(message);
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
