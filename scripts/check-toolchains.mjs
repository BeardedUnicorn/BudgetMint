#!/usr/bin/env node
/**
 * The pinned toolchains are well formed and agree:
 *
 * - rust-toolchain.toml names an exact X.Y.Z channel, with the wasm target
 *   the core builds for;
 * - .node-version is a major version (CI's setup-node reads it), and
 *   package.json's engines.node asks for at least that one;
 * - every workflow installs the wasm-bindgen CLI at the wasm-bindgen crate's
 *   version in Cargo.lock (scripts/build-wasm.mjs refuses any other).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(join(root, file), 'utf8');

const problems = [];

const toolchain = read('rust-toolchain.toml');
const channel = toolchain.match(/^channel\s*=\s*"(\d+\.\d+\.\d+)"/m);
if (!channel) problems.push('rust-toolchain.toml: no channel = "X.Y.Z"');
if (!/^targets\s*=.*"wasm32-unknown-unknown"/m.test(toolchain)) {
  problems.push('rust-toolchain.toml: targets should list wasm32-unknown-unknown');
}

const wasmBindgen = read('Cargo.lock').match(/name = "wasm-bindgen"\nversion = "([^"]+)"/)?.[1];
for (const file of existsSync(join(root, '.github/workflows')) ? readdirSync(join(root, '.github/workflows')) : []) {
  for (const [, version] of read(`.github/workflows/${file}`).matchAll(/tool: wasm-bindgen@(\S+)/g)) {
    if (version !== wasmBindgen)
      problems.push(`${file} installs wasm-bindgen ${version}, Cargo.lock has ${wasmBindgen}`);
  }
}

const node = read('.node-version').trim();
if (!/^\d+$/.test(node)) problems.push(`.node-version should be a major version, not "${node}"`);
const engines = JSON.parse(read('package.json')).engines?.node;
if (engines !== `>=${node}`) {
  problems.push(
    `package.json's engines.node should be ">=${node}", as .node-version says, not ${JSON.stringify(engines)}`
  );
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log(`Toolchains pinned: Rust ${channel[1]}, Node ${node}`);
