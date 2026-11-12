/**
 * The service worker's rules (worker.ts wires them to its events). It keeps
 * the app shell, the page and the files the build made, so BudgetMint opens
 * without a connection, and leaves every other request alone: Firestore
 * keeps its own offline copy of the budget, and sign-in is Google's.
 *
 * Each build is a new version, kept in a cache of its own. A new version
 * installs beside the old one and takes over once no tab runs the old one,
 * so an open tab never loses a file it still needs.
 */

/** What the build tells the worker about the shell (build/plugin.ts writes it). */
export interface ShellManifest {
  /** Changes whenever a file in the shell does. */
  version: string;
  /** Kept when the version installs: `/` (the page), then every file it loads. */
  files: string[];
  /** Kept the first time they're used: the fonts, since a browser loads only the scripts a page shows. */
  lazy: string[];
  /** The static pages (privacy, terms), by both their URLs: left to the network. */
  pages: string[];
}

/** The global the build sets to the manifest, before the worker's code. */
export const SHELL_GLOBAL = '__BUDGETMINT_SHELL__';

export const CACHE_PREFIX = 'budgetmint-shell-';

/** What the worker needs from its global scope. */
export interface WorkerContext {
  origin: string;
  caches: CacheStorage;
  fetch: (request: Request) => Promise<Response>;
}

export function serviceWorker(shell: ShellManifest, { origin, caches, fetch }: WorkerContext) {
  const name = `${CACHE_PREFIX}${shell.version}`;
  const files = new Set(shell.files);
  const lazy = new Set(shell.lazy);
  const pages = new Set(shell.pages);
  const open = () => caches.open(name);

  /** The kept copy, or the network's (kept now, for a lazy file the server really has). */
  async function kept(request: Request, path: string, keep: boolean): Promise<Response> {
    const cache = await open();
    const hit = await cache.match(path);
    if (hit) return hit;
    const response = await fetch(request);
    // A file gone from the server comes back as the page (Hosting's rewrite)
    if (keep && response.ok && !response.headers.get('content-type')?.startsWith('text/html')) {
      await cache.put(path, response.clone());
    }
    return response;
  }

  return {
    /** All or nothing: a failed install is tried again on the next visit. */
    async install(): Promise<void> {
      await (await open()).addAll(shell.files);
    },

    /** Drops the older versions' copies. */
    async activate(): Promise<void> {
      const older = (await caches.keys()).filter(key => key.startsWith(CACHE_PREFIX) && key !== name);
      await Promise.all(older.map(key => caches.delete(key)));
    },

    /** The answer to a request, or null to leave it to the browser. */
    respond(request: Request): Promise<Response> | null {
      if (request.method !== 'GET') return null;
      const url = new URL(request.url);
      // Firestore and Google's sign-in, and Firebase's reserved /__/ URLs
      if (url.origin !== origin || url.pathname.startsWith('/__/')) return null;
      if (request.mode === 'navigate') {
        if (pages.has(url.pathname)) return null;
        // The network first, so a new release shows at once; offline, the kept page
        return fetch(request).catch(async error => {
          const page = await (await open()).match('/');
          if (page) return page;
          throw error;
        });
      }
      if (files.has(url.pathname)) return kept(request, url.pathname, false);
      if (lazy.has(url.pathname)) return kept(request, url.pathname, true);
      return null;
    },
  };
}
