// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { CACHE_PREFIX, serviceWorker, type ShellManifest } from '../shell';

const ORIGIN = 'https://budgetmint.web.app';

const SHELL: ShellManifest = {
  version: 'v2',
  files: ['/', '/assets/index-abc.js', '/favicon.png'],
  lazy: ['/assets/inter-latin-400-def.woff2'],
  pages: ['/privacy', '/privacy.html'],
};

/** The browser's CacheStorage, in memory: each cache a map of path → response. */
function fakeCaches(network: (path: string) => Response, names: string[] = []) {
  const stores = new Map<string, Map<string, Response>>(names.map(name => [name, new Map()]));
  const open = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      async addAll(paths: string[]) {
        for (const path of paths) store.set(path, network(path));
      },
      async match(path: string) {
        return store.get(path)?.clone();
      },
      async put(path: string, response: Response) {
        store.set(path, response);
      },
    };
  };
  const caches = {
    open: vi.fn(async (name: string) => open(name)),
    keys: async () => [...stores.keys()],
    delete: vi.fn(async (name: string) => stores.delete(name)),
  } as unknown as CacheStorage;
  return { caches, stores };
}

const response = (body: string, type = 'text/javascript', status = 200) =>
  new Response(body, { status, headers: { 'content-type': type } });

/** A request as the worker sees it (a navigation can't be constructed outside a browser). */
const request = (path: string, { method = 'GET', mode = 'cors', origin = ORIGIN } = {}) =>
  ({ method, mode, url: `${origin}${path}` }) as Request;

function setup(network: (path: string) => Response = path => response(`network ${path}`)) {
  const fetch = vi.fn(async (req: Request) => network(new URL(req.url).pathname));
  const { caches, stores } = fakeCaches(network, ['budgetmint-shell-v1', 'firebase-heartbeat']);
  return { worker: serviceWorker(SHELL, { origin: ORIGIN, caches, fetch }), fetch, caches, stores };
}

describe('the service worker', () => {
  it('keeps every file of the shell when its version installs', async () => {
    const { worker, stores } = setup();
    await worker.install();
    expect([...stores.get(`${CACHE_PREFIX}v2`)!.keys()]).toEqual(SHELL.files);
  });

  it('drops older versions once it takes over, and leaves other caches alone', async () => {
    const { worker, stores } = setup();
    await worker.install();
    await worker.activate();
    expect([...stores.keys()]).toEqual(['firebase-heartbeat', `${CACHE_PREFIX}v2`]);
  });

  it('leaves Firestore, sign-in, Firebase’s own URLs and anything but a read to the browser', () => {
    const { worker } = setup();
    expect(worker.respond(request('/v1/projects', { origin: 'https://firestore.googleapis.com' }))).toBeNull();
    expect(worker.respond(request('/__/auth/handler', { mode: 'navigate' }))).toBeNull();
    expect(worker.respond(request('/__/firebase/init.json'))).toBeNull();
    expect(worker.respond(request('/', { method: 'POST' }))).toBeNull();
    expect(worker.respond(request('/robots.txt'))).toBeNull();
  });

  it('opens the page from the network, and the kept one offline', async () => {
    let online = true;
    const { worker } = setup(path => {
      if (!online) throw new TypeError('Failed to fetch');
      return response(`page at ${path}`, 'text/html');
    });
    await worker.install();
    expect(await (await worker.respond(request('/bills', { mode: 'navigate' }))!).text()).toBe('page at /bills');
    online = false;
    // Every route is the one page (Hosting's rewrite): the kept one
    expect(await (await worker.respond(request('/bills', { mode: 'navigate' }))!).text()).toBe('page at /');
  });

  it('fails offline as the browser would when nothing is kept yet', async () => {
    const { worker } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(worker.respond(request('/', { mode: 'navigate' }))!).rejects.toThrow('Failed to fetch');
  });

  it('leaves the static pages to the network', () => {
    const { worker } = setup();
    expect(worker.respond(request('/privacy', { mode: 'navigate' }))).toBeNull();
    expect(worker.respond(request('/privacy.html', { mode: 'navigate' }))).toBeNull();
  });

  it('answers the shell’s files from its copy, and the network when one is missing', async () => {
    const { worker, fetch, stores } = setup();
    await worker.install();
    fetch.mockClear();
    expect(await (await worker.respond(request('/assets/index-abc.js'))!).text()).toBe('network /assets/index-abc.js');
    expect(fetch).not.toHaveBeenCalled();

    stores.get(`${CACHE_PREFIX}v2`)!.delete('/favicon.png');
    expect(await (await worker.respond(request('/favicon.png'))!).text()).toBe('network /favicon.png');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(stores.get(`${CACHE_PREFIX}v2`)!.has('/favicon.png')).toBe(false);
  });

  it('keeps a font the first time it’s used', async () => {
    const font = SHELL.lazy[0];
    const { worker, fetch, stores } = setup(() => response('woff2', 'font/woff2'));
    expect(await (await worker.respond(request(font))!).text()).toBe('woff2');
    expect(stores.get(`${CACHE_PREFIX}v2`)!.has(font)).toBe(true);
    await worker.respond(request(font));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('doesn’t keep a font the server no longer has', async () => {
    const font = SHELL.lazy[0];
    // Hosting answers a missing file with the page; or the server fails
    for (const answer of [response('<!doctype html>', 'text/html; charset=utf-8'), response('', 'text/plain', 503)]) {
      const { worker, stores } = setup(() => answer.clone());
      await worker.respond(request(font));
      expect(stores.get(`${CACHE_PREFIX}v2`)?.has(font) ?? false).toBe(false);
    }
  });

  it('keeps a font served without a content type', async () => {
    const font = SHELL.lazy[0];
    const { worker, stores } = setup(() => new Response(new Uint8Array([1, 2, 3])));
    await worker.respond(request(font));
    expect(stores.get(`${CACHE_PREFIX}v2`)!.has(font)).toBe(true);
  });
});
