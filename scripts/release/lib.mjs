// Adapted from TaskMint scripts/release/lib.mjs @ 1623bee.
/**
 * The release's pure parts (scripts/release.mjs does the files, git and
 * builds): reading change notes, the next version, the CHANGELOG section,
 * the version in each manifest, what a release ships and how each host
 * builds it, the desktop app's updates (their files, their signatures and
 * latest.json), and the release's checksums. Tested by lib.test.mjs
 * (`node --test`).
 */

import { createHash, createPublicKey, verify } from 'node:crypto';

/** Bump levels, lowest first. */
export const BUMPS = ['patch', 'minor', 'major'];

/** Change types, in the order the CHANGELOG lists them (Keep a Changelog). */
export const TYPES = ['Added', 'Changed', 'Removed', 'Fixed', 'Security'];

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * A change note: front matter with `bump` and `type`, then the text for the
 * CHANGELOG. The text is one bullet, or one per `- ` line. Throws an error
 * that names the file when anything is missing or unknown.
 */
export function parseNote(file, text) {
  const fail = problem => {
    throw new Error(`${file}: ${problem} (see changes/README.md)`);
  };
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0].trim() !== '---') fail('it should start with a --- line');
  const end = lines.indexOf('---', 1);
  if (end === -1) fail('the front matter has no closing --- line');

  const fields = {};
  for (const line of lines.slice(1, end)) {
    const content = line.replace(/#.*$/, '').trim();
    if (content === '') continue;
    const match = content.match(/^([a-z]+):\s*(\S+)$/i);
    if (!match) fail(`can't read "${line.trim()}" (expected "key: value")`);
    const [, key, value] = match;
    if (key !== 'bump' && key !== 'type') fail(`unknown field "${key}"`);
    fields[key] = value;
  }
  if (!fields.bump) fail('no bump');
  if (!BUMPS.includes(fields.bump)) fail(`bump "${fields.bump}" isn't one of ${BUMPS.join(', ')}`);
  if (!fields.type) fail('no type');
  if (!TYPES.includes(fields.type)) fail(`type "${fields.type}" isn't one of ${TYPES.join(', ')}`);

  const items = noteItems(lines.slice(end + 1));
  if (items.length === 0) fail('no text for the changelog');
  return { file, bump: fields.bump, type: fields.type, items };
}

/** The body's bullets: each `- ` line starts one, and other lines join the one before. */
function noteItems(lines) {
  const items = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('- ')) items.push(line.slice(2).trim());
    else if (items.length > 0) items[items.length - 1] += ` ${line}`;
    else items.push(line);
  }
  return items;
}

/** The highest bump the notes ask for; null with no notes. */
export function highestBump(notes) {
  let highest = -1;
  for (const note of notes) highest = Math.max(highest, BUMPS.indexOf(note.bump));
  return highest === -1 ? null : BUMPS[highest];
}

export function isVersion(text) {
  return VERSION.test(text);
}

export function bumpVersion(version, bump) {
  const match = version.match(VERSION);
  if (!match) throw new Error(`"${version}" isn't a version like 1.2.3`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`"${bump}" isn't one of ${BUMPS.join(', ')}`);
}

/** A local date as YYYY-MM-DD. */
export function isoDate(date) {
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function sectionHeading(version, date) {
  return `## ${version} – ${date}`;
}

/** The CHANGELOG section for a release: its heading, then the notes by type (and file name within a type). */
export function renderSection(version, date, notes) {
  const parts = [sectionHeading(version, date)];
  if (notes.length === 0) parts.push('No user-facing changes.');
  for (const type of TYPES) {
    const ofType = notes.filter(note => note.type === type).sort((a, b) => a.file.localeCompare(b.file));
    if (ofType.length === 0) continue;
    parts.push(`### ${type}`, ofType.flatMap(note => note.items.map(item => `- ${item}`)).join('\n'));
  }
  return `${parts.join('\n\n')}\n`;
}

const HEADING = /^## (\S+)/;

/** The versions the CHANGELOG has sections for, newest first. */
export function changelogVersions(changelog) {
  return changelog.split('\n').flatMap(line => line.match(HEADING)?.[1] ?? []);
}

/** The CHANGELOG with a section added above the newest one (or at the end, with none yet). */
export function insertSection(changelog, version, section) {
  if (changelogVersions(changelog).includes(version)) throw new Error(`CHANGELOG.md already has ${version}`);
  const lines = changelog.split('\n');
  const first = lines.findIndex(line => HEADING.test(line));
  const added = section.trimEnd();
  if (first === -1) return `${changelog.trimEnd()}\n\n${added}\n`;
  return [...lines.slice(0, first), ...added.split('\n'), '', ...lines.slice(first)].join('\n');
}

/** A version's section without its heading (the release notes); null when it has none. */
export function extractSection(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.findIndex(line => line.match(HEADING)?.[1] === version);
  if (start === -1) return null;
  const next = lines.findIndex((line, index) => index > start && HEADING.test(line));
  return lines
    .slice(start + 1, next === -1 ? undefined : next)
    .join('\n')
    .trim();
}

// The version in each kind of manifest. Each edit replaces only the version
// text, so the file's formatting is kept.

const PACKAGE_JSON_VERSION = /^(\s*"version":\s*")([^"]*)(")/m;

export function packageJsonVersion(text, file) {
  const match = text.match(PACKAGE_JSON_VERSION);
  if (!match) throw new Error(`${file}: no "version"`);
  return match[2];
}

export function setPackageJsonVersion(text, version, file) {
  packageJsonVersion(text, file);
  return text.replace(PACKAGE_JSON_VERSION, `$1${version}$3`);
}

/** The [package] table: from its header to the next table. */
function packageTable(text, file) {
  const start = text.search(/^\[package\]\s*$/m);
  if (start === -1) throw new Error(`${file}: no [package] table`);
  const rest = text.slice(start + 1).search(/^\[/m);
  const end = rest === -1 ? text.length : start + 1 + rest;
  return { start, end, table: text.slice(start, end) };
}

function cargoField(text, field, file) {
  const match = packageTable(text, file).table.match(new RegExp(`^${field}\\s*=\\s*"([^"]*)"`, 'm'));
  if (!match) throw new Error(`${file}: no ${field} in [package]`);
  return match[1];
}

export const cargoTomlVersion = (text, file) => cargoField(text, 'version', file);
export const cargoTomlName = (text, file) => cargoField(text, 'name', file);

export function setCargoTomlVersion(text, version, file) {
  cargoTomlVersion(text, file);
  const { start, end, table } = packageTable(text, file);
  return text.slice(0, start) + table.replace(/^(version\s*=\s*")[^"]*(")/m, `$1${version}$2`) + text.slice(end);
}

const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Cargo.lock with each named package at the version; each must be listed exactly once. */
export function setCargoLockVersions(text, names, version) {
  let next = text;
  for (const name of names) {
    const entry = new RegExp(`(\\[\\[package\\]\\]\\nname = "${escapeRegex(name)}"\\nversion = ")[^"]*(")`, 'g');
    const count = next.match(entry)?.length ?? 0;
    if (count !== 1) throw new Error(`Cargo.lock lists ${name} ${count} times, expected once`);
    next = next.replace(entry, `$1${version}$2`);
  }
  return next;
}

// What a release ships: one file per target, each named
// `<product>-<version>-<suffix>`. The Release workflow builds every target a
// release ships, and a local release builds the computer's own installer
// unless told which.

/** Every target there's a build for, in the order the release lists them; the Release workflow builds each. */
export const TARGETS = ['macos-arm64', 'macos-x64', 'windows-x64', 'android-arm64'];

const SUFFIXES = {
  'macos-arm64': 'macos-arm64.dmg',
  'macos-x64': 'macos-x64.dmg',
  'windows-x64': 'windows-x64-setup.exe',
  'android-arm64': 'android-arm64.apk',
};

/** The desktop targets: the OS and CPU each runs on, and the Tauri bundle it comes from. */
const DESKTOP = {
  'macos-arm64': {
    platform: 'darwin',
    arch: 'arm64',
    triple: 'aarch64-apple-darwin',
    bundle: 'dmg',
    file: 'aarch64.dmg',
  },
  'macos-x64': { platform: 'darwin', arch: 'x64', triple: 'x86_64-apple-darwin', bundle: 'dmg', file: 'x64.dmg' },
  'windows-x64': {
    platform: 'win32',
    arch: 'x64',
    triple: 'x86_64-pc-windows-msvc',
    bundle: 'nsis',
    file: 'x64-setup.exe',
  },
};

/**
 * The Android targets: the Rust target, Tauri's name for it (`tauri android
 * build --target`) and where Gradle leaves the APK, relative to the
 * repository root.
 */
const ANDROID = {
  'android-arm64': {
    triple: 'aarch64-linux-android',
    tauriTarget: 'aarch64',
    apk: 'apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk',
  },
};

const PLATFORMS = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
const describeHost = ({ platform, arch }) => `${PLATFORMS[platform] ?? platform} (${arch})`;

export const isTarget = name => TARGETS.includes(name);

function requireTarget(target) {
  if (!isTarget(target)) throw new Error(`Unknown target "${target}" (one of ${TARGETS.join(', ')})`);
}

/** The file a target ships as. */
export function assetName(product, version, target) {
  requireTarget(target);
  return `${product}-${version}-${SUFFIXES[target]}`;
}

/** Every file a release ships: each target's, then the desktop updates' (latest.json aside, which is made from them). */
export function releaseAssets(product, version) {
  const updates = DESKTOP_TARGETS.flatMap(target => {
    const { file, signature } = updateAssetNames(product, version, target);
    // (Windows' update is its installer)
    return file === assetName(product, version, target) ? [signature] : [file, signature];
  });
  return [...TARGETS.map(target => assetName(product, version, target)), ...updates];
}

/** Every file a release ships for the version that isn't among `files` (file names). */
export function missingAssets(product, version, files) {
  return releaseAssets(product, version).filter(name => !files.includes(name));
}

/**
 * How a host builds a target: a Tauri build, `native` or cross-compiled with
 * `--target <triple>` (the other Mac CPU); `xwin`, the Windows installer
 * cross-compiled on a Mac; or `android`, the APK from `tauri android build`
 * (on macOS or Linux, with the Android SDK, NDK and a JDK). Throws for a
 * target the host can't build.
 */
export function buildPlan(target, host) {
  requireTarget(target);
  const desktop = DESKTOP[target];
  if (ANDROID[target]) {
    const { triple, tauriTarget } = ANDROID[target];
    if (host.platform === 'darwin' || host.platform === 'linux') return { kind: 'android', triple, tauriTarget };
  } else if (desktop.platform === host.platform) {
    return { kind: 'tauri', triple: desktop.arch === host.arch ? null : desktop.triple };
  } else if (target === 'windows-x64' && host.platform === 'darwin') {
    return { kind: 'xwin', triple: desktop.triple };
  }
  throw new Error(`${target} can't be built on ${describeHost(host)}`);
}

/** Where Tauri leaves a target's installer or APK, relative to the repository root. */
export function bundlePath(product, version, target, plan) {
  requireTarget(target);
  if (ANDROID[target] && plan.kind === 'android') return ANDROID[target].apk;
  const desktop = DESKTOP[target];
  if (!desktop || plan.kind === 'android') throw new Error(`${target} isn't a Tauri bundle`);
  const dir = plan.triple ? `target/${plan.triple}/release` : 'target/release';
  return `${dir}/bundle/${desktop.bundle}/${product}_${version}_${desktop.file}`;
}

/**
 * The targets to build: the ones named (in order, once each), or else the
 * host's own desktop installer. `windows` adds windows-x64.
 */
export function buildTargets({ targets = [], windows = false, platform, arch }) {
  for (const target of targets) requireTarget(target);
  let chosen = [...new Set(targets)];
  if (chosen.length === 0) {
    const own = Object.keys(DESKTOP).find(
      target => DESKTOP[target].platform === platform && DESKTOP[target].arch === arch
    );
    if (!own) throw new Error(`There's no installer for ${describeHost({ platform, arch })}: name one with --target`);
    chosen = [own];
  }
  if (windows && !chosen.includes('windows-x64')) chosen.push('windows-x64');
  return chosen;
}

// The desktop app's updates. With the signing key in TAURI_SIGNING_PRIVATE_KEY,
// a build also makes each desktop target's update (createUpdaterArtifacts):
// on macOS the app as a .app.tar.gz, on Windows the installer itself, each
// with a .sig. The release adds latest.json, which the app reads from the
// latest release (plugins.updater in tauri.conf.json).

/** The file the app's updater reads, in the latest GitHub release. */
export const UPDATE_MANIFEST = 'latest.json';

/** The desktop targets, in the order the release lists them. */
export const DESKTOP_TARGETS = TARGETS.filter(target => target in DESKTOP);

/** Each desktop target's name in latest.json, and its update's file suffix (null: the installer). */
const UPDATES = {
  'macos-arm64': { platform: 'darwin-aarch64', suffix: 'macos-arm64.app.tar.gz' },
  'macos-x64': { platform: 'darwin-x86_64', suffix: 'macos-x64.app.tar.gz' },
  'windows-x64': { platform: 'windows-x86_64', suffix: null },
};

function requireDesktop(target) {
  requireTarget(target);
  if (!DESKTOP[target]) throw new Error(`${target} has no updates`);
}

/** The files a desktop target's update ships as: `{ file, signature }`. */
export function updateAssetNames(product, version, target) {
  requireDesktop(target);
  const { suffix } = UPDATES[target];
  const file = suffix ? `${product}-${version}-${suffix}` : assetName(product, version, target);
  return { file, signature: `${file}.sig` };
}

/** Where Tauri leaves a desktop target's update and its signature, relative to the repository root. */
export function updateBundlePaths(product, version, target, plan) {
  requireDesktop(target);
  const installer = bundlePath(product, version, target, plan);
  if (!UPDATES[target].suffix) return { file: installer, signature: `${installer}.sig` };
  const file = installer.replace(/\/bundle\/[^/]+\/[^/]+$/, `/bundle/macos/${product}.app.tar.gz`);
  return { file, signature: `${file}.sig` };
}

/** Where a release's files download from. */
export function releaseDownloadUrl(repository, version) {
  return `https://github.com/${repository}/releases/download/v${version}`;
}

/**
 * latest.json: the version, its notes and date, and for each desktop target
 * its update's address and signature (`signatures`: the .sig files' text,
 * by target).
 */
export function updateManifest({ product, version, notes, pubDate, downloadUrl, signatures }) {
  const platforms = {};
  for (const target of DESKTOP_TARGETS) {
    const signature = signatures[target]?.trim();
    if (!signature) throw new Error(`There's no update signature for ${target}`);
    const { file } = updateAssetNames(product, version, target);
    platforms[UPDATES[target].platform] = { signature, url: `${downloadUrl}/${file}` };
  }
  return { version, notes, pub_date: pubDate, platforms };
}

// Minisign, as the updater checks it: a public key is "Ed", its 8-byte key
// id and the Ed25519 key; a signature is its algorithm ("ED": of the file's
// BLAKE2b-512, "Ed": of the file), the key id and the signature, then a
// trusted comment and a signature over both. Tauri base64-encodes each file.

/** A base64-encoded minisign file's lines. */
const minisignLines = text => Buffer.from(text.trim(), 'base64').toString('utf8').trimEnd().split('\n');

/** How minisign shows a key id. */
const keyId = bytes => Buffer.from(bytes).reverse().toString('hex').toUpperCase();

/**
 * Checks that `signature` (a .sig file's text) signs `data` with
 * `publicKey` (plugins.updater.pubkey), as the app does before it installs
 * an update. Throws saying what's wrong.
 */
export function verifyUpdateSignature({ publicKey, signature, data }) {
  const key = Buffer.from(minisignLines(publicKey)[1] ?? '', 'base64');
  if (key.length !== 42 || key.toString('latin1', 0, 2) !== 'Ed') {
    throw new Error("The app's updater public key (plugins.updater.pubkey) isn't a minisign public key");
  }
  const [, signed = '', trusted = '', global = ''] = minisignLines(signature);
  const signatureBytes = Buffer.from(signed, 'base64');
  const algorithm = signatureBytes.toString('latin1', 0, 2);
  if (signatureBytes.length !== 74 || (algorithm !== 'ED' && algorithm !== 'Ed')) {
    throw new Error("The update's signature isn't a minisign signature");
  }
  const signedBy = keyId(signatureBytes.subarray(2, 10));
  const trustedKey = keyId(key.subarray(2, 10));
  if (signedBy !== trustedKey) {
    throw new Error(`The update is signed with key ${signedBy}, but the app trusts key ${trustedKey}`);
  }
  const ed25519 = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: key.subarray(10).toString('base64url') },
    format: 'jwk',
  });
  const message = algorithm === 'ED' ? createHash('blake2b512').update(data).digest() : data;
  if (!verify(null, message, ed25519, signatureBytes.subarray(10))) {
    throw new Error("The update's signature doesn't match the file");
  }
  const comment = Buffer.from(trusted.replace(/^trusted comment: /, ''));
  if (!verify(null, Buffer.concat([signatureBytes.subarray(10), comment]), ed25519, Buffer.from(global, 'base64'))) {
    throw new Error("The update signature's trusted comment doesn't match it");
  }
}

// The APK's signature. Android installs an APK over the app only when both
// are signed with the same key, so every release has to be signed with the
// release key (the README's "Android signing").

/**
 * Checks that `apksigner verify --print-certs` (its `output`) found exactly
 * one signer, with the certificate whose SHA-256 is `digest`. Throws saying
 * what's wrong.
 *
 * Build-Tools 36 and earlier print "Signer #1 certificate SHA-256 digest: …";
 * 37 prints the strongest scheme it verified instead, numbering the signers
 * only when there's more than one ("V2 Signer: certificate SHA-256 digest: …",
 * "V2 Signer #2: certificate …"), so both read the same here.
 */
export function verifyApkSigner({ output, digest }) {
  const signerLine = /^(?:V[\d.]+ Signer(?: #\d+)?:|Signer #\d+) certificate SHA-256 digest: ([0-9a-f]+)\s*$/gim;
  const found = [...output.matchAll(signerLine)].map(match => match[1].toLowerCase());
  if (found.length === 0) throw new Error('apksigner found no signer in the APK');
  if (found.length > 1) throw new Error(`The APK has ${found.length} signers; a release has one`);
  if (found[0] !== digest.toLowerCase()) {
    throw new Error(`The APK is signed with certificate ${found[0]}, but releases are signed with ${digest}`);
  }
}

// The release's checksums, so a download can be checked against the release
// it came from.

/** The checksums file a release ships. */
export const CHECKSUMS = 'SHA256SUMS';

/** SHA256SUMS for `files` (`{ name, data }`), as `sha256sum` writes it and `sha256sum -c` checks it. */
export function sha256Sums(files) {
  return files.map(({ name, data }) => `${createHash('sha256').update(data).digest('hex')}  ${name}\n`).join('');
}
