/**
 * The web app's additions to Vite (vite.config.ts; this runs in Node, at
 * build time, and isn't part of the app):
 *
 * - **Its own public folder,** apps/web/public, beside the shared client's
 *   (Vite's `publicDir`, which takes only one): the manifest and icons,
 *   robots.txt, and the privacy and terms pages. Development serves it,
 *   with each page at its clean URL too as Hosting serves it (firebase.json's
 *   `cleanUrls`), and the build copies it into dist/.
 * - **The service worker:** offline/worker.ts, built as /sw.js with the
 *   shell's manifest (offline/shell.ts) set before its code.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { SHELL_GLOBAL, type ShellManifest } from '../offline/shell';

/** Where the service worker is served: the site's root, so it controls every page. */
export const SERVICE_WORKER = 'sw.js';

export interface WebBuildOptions {
  /** The web app's own public folder. */
  publicDir: string;
  /** The service worker's entry. */
  worker: string;
  /** Public files the worker never keeps: only crawlers and link previews ask for them. */
  notOffline: string[];
}

/** Every file under `dir` (none if it isn't there), by its path from `dir` with `/`, sorted; dotfiles aside, as Hosting ignores them. */
export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && !entry.name.startsWith('.'))
    .map(entry => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

const FONT = /\.woff2?$/;

/**
 * The shell's manifest, from every file the build writes (path → content):
 * the page as `/`, the static pages by both their URLs, the fonts to keep
 * once used, and every other file to keep at install. The worker itself,
 * source maps and `notOffline` are left out. The version is a hash of the
 * kept files' paths and contents.
 */
export function shellManifest(output: Map<string, string | Uint8Array>, notOffline: string[]): ShellManifest {
  const files: string[] = [];
  const lazy: string[] = [];
  const pages: string[] = [];
  const version = createHash('sha256');
  for (const file of [...output.keys()].sort()) {
    if (file === SERVICE_WORKER || file.endsWith('.map') || notOffline.includes(file)) continue;
    if (file.endsWith('.html') && file !== 'index.html') {
      pages.push(`/${file.slice(0, -'.html'.length)}`, `/${file}`);
      continue;
    }
    const path = file === 'index.html' ? '/' : `/${file}`;
    if (FONT.test(file)) lazy.push(path);
    else if (path === '/') files.unshift(path);
    else files.push(path);
    version.update(`${path}\0`).update(output.get(file)!).update('\0');
  }
  return { version: version.digest('hex').slice(0, 16), files, lazy, pages };
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export const contentType = (file: string): string => CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';

/** The file in `dir` a request's URL names, its page for a clean URL, or null (also for a URL outside `dir`). */
export function publicFile(dir: string, url: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    return null;
  }
  const root = resolve(dir);
  for (const candidate of [pathname, `${pathname}.html`]) {
    const file = join(root, candidate);
    if (file.startsWith(`${root}${sep}`) && existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

/** Development's middleware for `dir`: its files, and anything else to the next. */
export function servePublic(dir: string) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
    const file = publicFile(dir, request.url ?? '/');
    if (!file) {
      next();
      return;
    }
    response.setHeader('Content-Type', contentType(file));
    response.end(readFileSync(file));
  };
}

export function webBuild({ publicDir, worker, notOffline }: WebBuildOptions): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'budgetmint-web',
    configResolved(resolved) {
      config = resolved;
    },
    configureServer(server) {
      server.middlewares.use(servePublic(publicDir));
    },
    buildStart() {
      if (config.command === 'build') this.emitFile({ type: 'chunk', id: worker, fileName: SERVICE_WORKER });
    },
    generateBundle() {
      const shared = new Set(listFiles(config.publicDir));
      for (const file of listFiles(publicDir)) {
        if (shared.has(file)) this.error(`${file} is in both ${publicDir} and ${config.publicDir}: keep one`);
        this.emitFile({ type: 'asset', fileName: file, source: readFileSync(join(publicDir, file)) });
      }
    },
    writeBundle(options, bundle) {
      const sw = bundle[SERVICE_WORKER];
      // A worker registered as a classic script can't import another chunk
      if (sw?.type !== 'chunk' || sw.imports.length > 0 || sw.dynamicImports.length > 0) {
        this.error(`${SERVICE_WORKER} must be one script, with nothing it imports from the app's chunks`);
      }
      const output = new Map<string, string | Uint8Array>();
      for (const [file, item] of Object.entries(bundle))
        output.set(file, item.type === 'chunk' ? item.code : item.source);
      for (const file of listFiles(config.publicDir)) output.set(file, readFileSync(join(config.publicDir, file)));
      const shell = shellManifest(output, notOffline);
      writeFileSync(join(options.dir!, SERVICE_WORKER), `self.${SHELL_GLOBAL} = ${JSON.stringify(shell)};\n${sw.code}`);
    },
  };
}
