// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { build, type Plugin } from 'vite';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { SHELL_GLOBAL, type ShellManifest } from '../../offline/shell';
import { contentType, listFiles, publicFile, servePublic, shellManifest, webBuild } from '../plugin';

const temp = mkdtempSync(join(tmpdir(), 'budgetmint-web-build-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

let made = 0;
/** A folder with these files (path → text), under the test's temporary one. */
function folder(files: Record<string, string>): string {
  const dir = join(temp, `dir-${++made}`);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

describe('listing a public folder', () => {
  it('lists its files with / paths, sorted, without dotfiles or folders', () => {
    const dir = folder({ 'robots.txt': '', 'icons/icon-192.png': '', '.DS_Store': '', 'a.html': '' });
    mkdirSync(join(dir, 'empty'));
    expect(listFiles(dir)).toEqual(['a.html', 'icons/icon-192.png', 'robots.txt']);
  });

  it('is empty for a folder that isn’t there', () => {
    expect(listFiles(join(temp, 'missing'))).toEqual([]);
  });
});

describe('the shell’s manifest', () => {
  const output = (changes: Record<string, string> = {}) =>
    new Map<string, string | Uint8Array>(
      Object.entries({
        'assets/index-abc.js': 'app',
        'assets/index-abc.js.map': 'map',
        'assets/inter-latin-400-def.woff2': 'font',
        'assets/inter-latin-400-def.woff': 'old font',
        'budgetmint_core_bg.wasm': 'wasm',
        'favicon.png': 'icon',
        'index.html': '<html>',
        'privacy.html': 'privacy',
        'robots.txt': 'robots',
        'social.png': 'card',
        'sw.js': 'worker',
        ...changes,
      })
    );

  it('keeps the page as /, then the files it loads, the fonts once used, and leaves the static pages alone', () => {
    const { version, ...shell } = shellManifest(output(), ['robots.txt', 'social.png']);
    expect(shell).toEqual({
      files: ['/', '/assets/index-abc.js', '/budgetmint_core_bg.wasm', '/favicon.png'],
      lazy: ['/assets/inter-latin-400-def.woff', '/assets/inter-latin-400-def.woff2'],
      pages: ['/privacy', '/privacy.html'],
    });
    expect(version).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is a new version when a kept file changes, and only then', () => {
    const version = (changes: Record<string, string>) => shellManifest(output(changes), ['robots.txt']).version;
    const before = version({});
    expect(version({ 'index.html': '<html lang="en">' })).not.toBe(before);
    expect(version({ 'assets/inter-latin-400-def.woff2': 'new font' })).not.toBe(before);
    expect(version({ 'robots.txt': 'Disallow', 'sw.js': 'other', 'privacy.html': 'new' })).toBe(before);
  });
});

describe('the public folder in development', () => {
  const dir = folder({
    'privacy.html': '<p>Privacy</p>',
    'manifest.webmanifest': '{}',
    'icons/icon-192.png': 'png',
    'data.bin': 'bytes',
  });

  it('names each file by its type', () => {
    expect(contentType('privacy.html')).toBe('text/html; charset=utf-8');
    expect(contentType('manifest.webmanifest')).toBe('application/manifest+json');
    expect(contentType('icons/icon-192.png')).toBe('image/png');
    expect(contentType('data.bin')).toBe('application/octet-stream');
  });

  it('finds a file by its URL, and a page by its clean URL too', () => {
    expect(publicFile(dir, '/manifest.webmanifest?v=1')).toBe(join(dir, 'manifest.webmanifest'));
    expect(publicFile(dir, '/privacy')).toBe(join(dir, 'privacy.html'));
    expect(publicFile(dir, '/privacy.html')).toBe(join(dir, 'privacy.html'));
    expect(publicFile(dir, '/icons/icon%2D192.png')).toBe(join(dir, 'icons/icon-192.png'));
  });

  it('finds nothing for the app’s routes, folders, a malformed URL or one outside the folder', () => {
    expect(publicFile(dir, '/')).toBeNull();
    expect(publicFile(dir, '/bills')).toBeNull();
    expect(publicFile(dir, '/icons')).toBeNull();
    expect(publicFile(dir, '/%E0%A4%A')).toBeNull();
    expect(publicFile(dir, '/%2e%2e/%2e%2e/etc/hosts')).toBeNull();
  });

  it('serves its files, and passes anything else on to Vite', () => {
    const serve = servePublic(dir);
    const response = { setHeader: vi.fn(), end: vi.fn() } as unknown as ServerResponse;
    const next = vi.fn();
    serve({ url: '/privacy' } as IncomingMessage, response, next);
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
    expect(String(vi.mocked(response.end).mock.calls[0][0])).toBe('<p>Privacy</p>');
    expect(next).not.toHaveBeenCalled();

    serve({ url: '/settings' } as IncomingMessage, response, next);
    serve({} as IncomingMessage, response, next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('is served by the development server, which builds no worker', () => {
    const plugin = webBuild({ publicDir: dir, worker: 'worker.js', notOffline: [] });
    const use = vi.fn();
    (plugin.configureServer as (server: unknown) => void)({ middlewares: { use } });
    expect(use).toHaveBeenCalledWith(expect.any(Function));

    const emitFile = vi.fn();
    (plugin.configResolved as (config: unknown) => void)({ command: 'serve' });
    (plugin.buildStart as (this: unknown) => void).call({ emitFile });
    expect(emitFile).not.toHaveBeenCalled();
  });
});

/** Builds a small app with the plugin: the page and its script, the worker, and the two public folders. */
async function buildApp({ app = {}, shared = {}, own = {} }: Record<string, Record<string, string>>) {
  const root = folder({
    'index.html': '<!doctype html><script type="module" src="/main.js"></script>',
    'main.js': 'document.title = "app";',
    'worker.js': `self.addEventListener('fetch', () => self.${SHELL_GLOBAL});`,
    ...app,
  });
  const plugins: Plugin[] = [
    webBuild({ publicDir: folder(own), worker: join(root, 'worker.js'), notOffline: ['robots.txt'] }),
  ];
  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    publicDir: folder(shared),
    plugins,
    build: { outDir: join(root, 'dist'), emptyOutDir: true },
  });
  const dist = join(root, 'dist');
  const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
  const [first, ...code] = sw.split('\n');
  const shell = JSON.parse(first.replace(`self.${SHELL_GLOBAL} = `, '').replace(/;$/, '')) as ShellManifest;
  return { dist, shell, code: code.join('\n') };
}

describe('the build', () => {
  it('copies both public folders, and writes the worker at the root with the shell’s manifest before it', async () => {
    const { dist, shell, code } = await buildApp({
      shared: { 'favicon.png': 'icon' },
      own: { 'manifest.webmanifest': '{}', 'privacy.html': '<p>Privacy</p>', 'robots.txt': 'Allow: /' },
    });
    expect(listFiles(dist)).toEqual(
      [
        expect.stringMatching(/^assets\/index-[\w-]+\.js$/),
        'index.html',
        'manifest.webmanifest',
        'privacy.html',
        'robots.txt',
        'sw.js',
        'favicon.png',
      ].sort()
    );
    expect(readFileSync(join(dist, 'privacy.html'), 'utf8')).toBe('<p>Privacy</p>');
    expect(shell.files).toEqual([
      '/',
      expect.stringMatching(/^\/assets\/index-/),
      '/favicon.png',
      '/manifest.webmanifest',
    ]);
    expect(shell.pages).toEqual(['/privacy', '/privacy.html']);
    expect(code).toContain(`self.addEventListener(`);
  });

  it('refuses a file in both public folders', async () => {
    await expect(buildApp({ shared: { 'favicon.png': 'a' }, own: { 'favicon.png': 'b' } })).rejects.toThrow(
      /favicon\.png is in both/
    );
  });

  it('refuses a worker that would import the app’s chunks', async () => {
    await expect(
      buildApp({
        app: {
          'main.js': 'import { shared } from "./shared.js"; document.title = shared();',
          'shared.js': 'export const shared = () => "both";',
          'worker.js': 'import { shared } from "./shared.js"; self.addEventListener("fetch", shared);',
        },
      })
    ).rejects.toThrow(/sw\.js must be one script/);
  });
});
