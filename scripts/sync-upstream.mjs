#!/usr/bin/env node
/**
 * What BudgetMint keeps from TaskMint, pinned (firebase/UPSTREAM.json): the
 * Firestore rules (TaskMint's release deploys them; BudgetMint tests against
 * them), the payout forecast's contract and its golden fixtures. They're
 * never edited here: change them in TaskMint, then pull.
 *
 *   --check               every pinned file is here, unchanged (offline; verify runs it)
 *   --pull [--from <dir>] copies them again from a TaskMint checkout (default
 *                         ../taskmint-app), pinning its commit
 *   --pull --ref <ref>    copies them from GitHub at <ref> instead
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PIN = 'firebase/UPSTREAM.json';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** The files a source maps to: itself, or (a folder, ending in /) each JSON file in it. */
export function expand(source, listFolder) {
  if (!source.from.endsWith('/')) return [{ from: source.from, to: source.to }];
  return listFolder(source.from)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => ({ from: `${source.from}${name}`, to: `${source.to}${name}` }));
}

/** What's wrong with the copies here, against the pin: missing, changed, or not pinned. */
export function problems(pin, readLocal, listLocal) {
  const found = [];
  for (const [path, hash] of Object.entries(pin.files)) {
    const bytes = readLocal(path);
    if (bytes === null) found.push(`${path} is missing`);
    else if (sha256(bytes) !== hash) found.push(`${path} isn't TaskMint's (edited here?)`);
  }
  for (const source of pin.sources.filter(s => s.to.endsWith('/'))) {
    for (const name of listLocal(source.to)) {
      if (!(`${source.to}${name}` in pin.files)) found.push(`${source.to}${name} isn't pinned`);
    }
  }
  return found;
}

const readPin = () => JSON.parse(readFileSync(join(root, PIN), 'utf8'));
const readLocal = path => (existsSync(join(root, path)) ? readFileSync(join(root, path)) : null);
const listLocal = dir => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)) : []);

function check() {
  const found = problems(readPin(), readLocal, listLocal);
  if (found.length > 0) {
    console.error(`${found.join('\n')}\nThese come from TaskMint: pnpm upstream:pull (see ${PIN}).`);
    process.exit(1);
  }
  console.log(`TaskMint's files match ${PIN}`);
}

/** A TaskMint checkout as a source: its files, and the commit they're at. */
function localSource(dir) {
  const git = args => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  const commit = git(['rev-parse', 'HEAD']);
  return {
    ref: git(['status', '--porcelain']) ? `${commit} (with uncommitted changes)` : commit,
    read: path => readFileSync(join(dir, path)),
    list: folder => readdirSync(join(dir, folder)),
  };
}

/** TaskMint on GitHub at `ref`, as a source. */
async function githubSource(repo, ref) {
  const get = async url => {
    const response = await fetch(url, { headers: { 'User-Agent': 'budgetmint-sync-upstream' } });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response;
  };
  const listings = new Map();
  return {
    ref,
    async prepare(folders) {
      for (const folder of folders) {
        const url = `https://api.github.com/repos/${repo}/contents/${folder}?ref=${ref}`;
        listings.set(
          folder,
          (await (await get(url)).json()).map(entry => entry.name)
        );
      }
    },
    list: folder => listings.get(folder),
    read: async path =>
      Buffer.from(await (await get(`https://raw.githubusercontent.com/${repo}/${ref}/${path}`)).arrayBuffer()),
  };
}

async function pull(args) {
  const pin = readPin();
  const refAt = args.indexOf('--ref');
  const fromAt = args.indexOf('--from');
  const source =
    refAt === -1
      ? localSource(fromAt === -1 ? join(root, '../taskmint-app') : args[fromAt + 1])
      : await githubSource(pin.repo, args[refAt + 1]);
  await source.prepare?.(pin.sources.filter(s => s.from.endsWith('/')).map(s => s.from));

  const files = {};
  for (const folder of pin.sources.filter(s => s.to.endsWith('/'))) {
    rmSync(join(root, folder.to), { recursive: true, force: true });
  }
  for (const source_ of pin.sources) {
    for (const { from, to } of expand(source_, source.list)) {
      const bytes = await source.read(from);
      mkdirSync(dirname(join(root, to)), { recursive: true });
      writeFileSync(join(root, to), bytes);
      files[to] = sha256(bytes);
    }
  }
  writeFileSync(join(root, PIN), `${JSON.stringify({ ...pin, ref: source.ref, files }, null, 2)}\n`);
  console.log(`Pinned TaskMint at ${source.ref}: ${Object.keys(files).length} files`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--pull')) await pull(args);
  else check();
}
