#!/usr/bin/env node
/**
 * Enforces coverage-policy.json (see docs/coverage-policy.md):
 *
 * - no inline coverage ignores in source (v8/istanbul/c8 ignore, coverage(off));
 * - every TypeScript package with a vitest.config.ts is listed in the policy
 *   and builds its config with defineBudgetmintConfig, without a coverage block
 *   or exclude list of its own;
 * - every policy entry points at a package that exists, and every excluded
 *   Rust file exists (a crate the policy lists before it's created is skipped).
 *
 * `--rust-ignore-regex <crate dir>` prints the --ignore-filename-regex for that
 * crate's cargo llvm-cov run instead: its excluded files plus every other
 * crate, so a crate is only ever covered by its own tests.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const policy = JSON.parse(readFileSync(join(root, 'coverage-policy.json'), 'utf8'));

const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function rustIgnoreRegex(crate) {
  const own = policy.rust[crate];
  if (!own) throw new Error(`${crate} is not a crate in coverage-policy.json`);
  const others = Object.keys(policy.rust)
    .filter(dir => dir !== crate)
    .map(dir => `${escapeRegex(dir)}/`);
  const files = own.map(entry => `${escapeRegex(`${crate}/${entry.file}`)}$`);
  return [...others, ...files].join('|');
}

const flag = process.argv.indexOf('--rust-ignore-regex');
if (flag !== -1) {
  console.log(rustIgnoreRegex(process.argv[flag + 1]));
  process.exit(0);
}

const problems = [];

// Source trees that ship; docs and this script may name the banned markers.
const SOURCE_DIRS = ['packages', 'apps', 'crates'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', 'gen', 'coverage', '.sqlx']);
const SOURCE_FILE = /\.(rs|ts|tsx|js|mjs|cjs|jsx)$/;
const BANNED = [/\b(?:v8|istanbul|c8)\s+ignore\b/, /#!?\[\s*(?:cfg_attr\s*\([^)]*,\s*)?coverage\s*\(\s*off\s*\)/];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (SOURCE_FILE.test(name)) yield path;
  }
}

for (const top of SOURCE_DIRS) {
  const dir = join(root, top);
  if (!existsSync(dir)) continue;
  for (const file of walk(dir)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (BANNED.some(pattern => pattern.test(line))) {
          problems.push(`${relative(root, file)}:${index + 1}: inline coverage ignores are banned`);
        }
      });
  }
}

const tsPackages = policy.typescript.packages;
for (const top of ['apps', 'packages']) {
  const dir = join(root, top);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    const packageDir = `${top}/${name}`;
    const configPath = join(root, packageDir, 'vitest.config.ts');
    if (!existsSync(configPath)) continue;
    const config = readFileSync(configPath, 'utf8');
    if (!(packageDir in tsPackages)) {
      problems.push(`${packageDir}: has a vitest config but isn't listed in coverage-policy.json`);
    }
    if (!config.includes('defineBudgetmintConfig(')) {
      problems.push(`${packageDir}/vitest.config.ts: must use defineBudgetmintConfig from vitest.shared.ts`);
    }
    if (!config.includes(`packageDir: '${packageDir}'`)) {
      problems.push(`${packageDir}/vitest.config.ts: packageDir must be '${packageDir}'`);
    }
    if (/\b(coverage|exclude)\s*:/.test(config)) {
      problems.push(`${packageDir}/vitest.config.ts: coverage settings and exclusions belong in coverage-policy.json`);
    }
  }
}

for (const packageDir of Object.keys(tsPackages)) {
  if (!existsSync(join(root, packageDir, 'vitest.config.ts'))) {
    problems.push(`coverage-policy.json: ${packageDir} has no vitest.config.ts`);
  }
}

for (const [crate, entries] of Object.entries(policy.rust)) {
  if (!existsSync(join(root, crate, 'Cargo.toml'))) continue;
  for (const { file } of entries) {
    if (!existsSync(join(root, crate, file))) {
      problems.push(`coverage-policy.json: ${crate}/${file} doesn't exist`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('Coverage policy OK');
