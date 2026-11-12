// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHELL_GLOBAL, type ShellManifest } from '../shell';

const SHELL: ShellManifest = { version: 'v1', files: ['/'], lazy: [], pages: [] };

/** A service worker's global scope: its listeners, its caches and its network. */
function fakeScope() {
  const listeners = new Map<string, (event: any) => void>();
  const opened: string[] = [];
  const scope = {
    [SHELL_GLOBAL]: SHELL,
    location: { origin: 'https://budgetmint.web.app' },
    caches: {
      open: vi.fn(async (name: string) => {
        opened.push(name);
        return { addAll: vi.fn(async () => undefined), match: vi.fn(async () => undefined) };
      }),
      keys: vi.fn(async () => ['budgetmint-shell-v0']),
      delete: vi.fn(async () => true),
    },
    clients: { claim: vi.fn(async () => undefined) },
    fetch: vi.fn(async () => new Response('page')),
    addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener),
  };
  return { scope, listeners, opened };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('the service worker’s events', () => {
  it('installs the shell, then takes over the open tab once the older versions are gone', async () => {
    const { scope, listeners, opened } = fakeScope();
    vi.stubGlobal('self', scope);
    await import('../worker');

    let installing: Promise<unknown> | undefined;
    listeners.get('install')!({ waitUntil: (promise: Promise<unknown>) => (installing = promise) });
    await installing;
    expect(opened).toEqual(['budgetmint-shell-v1']);

    let activating: Promise<unknown> | undefined;
    listeners.get('activate')!({ waitUntil: (promise: Promise<unknown>) => (activating = promise) });
    await activating;
    expect(scope.caches.delete).toHaveBeenCalledWith('budgetmint-shell-v0');
    expect(scope.clients.claim).toHaveBeenCalled();
  });

  it('answers the requests the shell has a rule for, and leaves the rest to the browser', async () => {
    const { scope, listeners } = fakeScope();
    vi.stubGlobal('self', scope);
    await import('../worker');

    const respondWith = vi.fn();
    const page = { method: 'GET', mode: 'navigate', url: 'https://budgetmint.web.app/' } as Request;
    listeners.get('fetch')!({ request: page, respondWith });
    expect(await (await respondWith.mock.calls[0][0]).text()).toBe('page');
    expect(scope.fetch).toHaveBeenCalledWith(page);

    respondWith.mockClear();
    const write = { method: 'POST', mode: 'cors', url: 'https://firestore.googleapis.com/v1' } as Request;
    listeners.get('fetch')!({ request: write, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  });
});
