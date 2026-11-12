/**
 * The service worker, built as /sw.js (build/plugin.ts) with the shell's
 * manifest set before it. shell.ts has its rules; this wires them to the
 * worker's events.
 */

import { SHELL_GLOBAL, serviceWorker, type ShellManifest } from './shell';

// The worker's own types (the app's TypeScript has the DOM's, not a worker's)
interface ExtendableEvent {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}

interface WorkerScope {
  readonly location: { readonly origin: string };
  readonly caches: CacheStorage;
  readonly clients: { claim(): Promise<void> };
  readonly [SHELL_GLOBAL]: ShellManifest;
  fetch(request: Request): Promise<Response>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
}

const scope = self as unknown as WorkerScope;
const worker = serviceWorker(scope[SHELL_GLOBAL], {
  origin: scope.location.origin,
  caches: scope.caches,
  fetch: request => scope.fetch(request),
});

scope.addEventListener('install', event => event.waitUntil(worker.install()));
// The first version controls the tab that installed it at once, so the
// fonts that tab loads are kept too
scope.addEventListener('activate', event => event.waitUntil(worker.activate().then(() => scope.clients.claim())));
scope.addEventListener('fetch', event => {
  const response = worker.respond(event.request);
  if (response) event.respondWith(response);
});
