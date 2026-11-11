import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoreStopped, coreClient, deviceZone, getCore, loadCore, setCoreForTest } from '..';
import { TEST_NOW, wasmBytes } from '../../testing';

afterEach(() => setCoreForTest(null));

describe('core', () => {
  it('loads from its wasm, and runs commands at the time and zone given', async () => {
    expect(() => getCore()).toThrow('BudgetMint’s core hasn’t loaded');
    const loaded = await loadCore(wasmBytes(), 'Asia/Tokyo');
    expect(getCore()).toBe(loaded);
    // Tokyo is a day ahead of most places at this hour
    expect(loaded.call('get_overview').today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    loaded.setZone('America/Chicago');
    expect(deviceZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('turns a refusal into an Error with the message to show', () => {
    const calls: unknown[][] = [];
    const client = coreClient(
      {
        call: (...args: unknown[]) => {
          calls.push(args);
          if (args[0] === 'set_balance') throw 'Set the balance as of today or a day before';
          return '{"ok":true}';
        },
        setZone: () => undefined,
      } as never,
      () => TEST_NOW
    );
    expect(client.call('get_settings')).toEqual({ ok: true });
    expect(calls[0]).toEqual(['get_settings', '{}', TEST_NOW]);
    expect(() => client.call('set_balance', { balance: { cents: 1, asOf: '2030-01-01' } })).toThrow(
      new Error('Set the balance as of today or a day before')
    );
    client.setZone('UTC');
  });

  it('stops for good once its WebAssembly traps, saying to reload', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let calls = 0;
    const client = coreClient({
      call: () => {
        calls += 1;
        throw new WebAssembly.RuntimeError('unreachable');
      },
      setZone: () => undefined,
    } as never);
    expect(() => client.call('get_overview')).toThrow(CoreStopped);
    // Not called again: what it holds can't be trusted
    expect(() => client.call('get_overview')).toThrow(/Reload to start it again/);
    expect(calls).toBe(1);
    quiet.mockRestore();
  });

  it('times calls by the clock when none is given', () => {
    let at = 0;
    const client = coreClient({
      call: (_name: string, _args: string, now: number) => {
        at = now;
        return 'null';
      },
      setZone: () => undefined,
    } as never);
    client.call('reset_docs');
    expect(Math.abs(at - Date.now())).toBeLessThan(1000);
  });
});
