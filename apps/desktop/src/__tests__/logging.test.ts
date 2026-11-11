import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { describe as describeValue, forwardLogs } from '../logging';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));

/** The lines sent to the log, in order. */
function logged() {
  return vi.mocked(invoke).mock.calls.map(([, payload]) => (payload as { args: unknown }).args);
}

let stop: () => void;
/** The console's own printing, under the forwarding. */
let printed: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

beforeEach(() => {
  // Quiet: what the console prints is the test runner's
  printed = {
    error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
  };
  stop = forwardLogs();
});

afterEach(() => {
  stop();
  vi.restoreAllMocks();
});

describe("the webview's log lines", () => {
  it('sends errors and warnings, and still prints them', () => {
    console.error('Failed to listen for update-progress:', 'denied');
    console.warn('Automatic update check failed:', { code: 7 });
    expect(logged()).toEqual([
      { level: 'error', message: 'Failed to listen for update-progress: denied' },
      { level: 'warn', message: 'Automatic update check failed: {"code":7}' },
    ]);
    expect(printed.error).toHaveBeenCalledWith('Failed to listen for update-progress:', 'denied');
    expect(printed.warn).toHaveBeenCalledWith('Automatic update check failed:', { code: 7 });
  });

  it('sends errors nothing caught, and rejections nothing handled', () => {
    const error = new Error('boom');
    window.dispatchEvent(new ErrorEvent('error', { error, message: 'boom' }));
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'not allowed' }));
    expect(logged()).toEqual([
      { level: 'error', message: `Uncaught ${error.stack}` },
      { level: 'error', message: 'Uncaught Script error.' },
      { level: 'error', message: 'Unhandled rejection: not allowed' },
    ]);
  });

  it("drops a line it can't send, without another", async () => {
    vi.mocked(invoke).mockRejectedValueOnce('the shell is gone');
    console.error('first');
    await Promise.resolve();
    expect(logged()).toHaveLength(1);
  });

  it('stops when asked', () => {
    stop();
    console.error('not sent');
    window.dispatchEvent(new ErrorEvent('error', { message: 'not sent' }));
    expect(logged()).toEqual([]);
  });
});

describe('a console argument, as text', () => {
  it('is an error with its stack, or the text, or JSON', () => {
    const error = new Error('boom');
    expect(describeValue(error)).toBe(error.stack);
    const bare = new TypeError('no stack');
    bare.stack = undefined;
    expect(describeValue(bare)).toBe('TypeError: no stack');
    expect(describeValue('text')).toBe('text');
    expect(describeValue({ a: [1] })).toBe('{"a":[1]}');
    expect(describeValue(undefined)).toBe('undefined');
  });

  it("is what String says when JSON can't say it", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(describeValue(cycle)).toBe('[object Object]');
    expect(describeValue(10n)).toBe('10');
  });
});
