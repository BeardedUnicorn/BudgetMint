#!/usr/bin/env node
// Adapted from TaskMint scripts/release.mjs @ 1623bee.
/**
 * Cuts a BudgetMint release from the change notes in changes/ (see
 * changes/README.md): bumps the shared version by the highest note, writes
 * the CHANGELOG section, then commits "Release X.Y.Z" and tags vX.Y.Z. It
 * builds nothing, and nothing is pushed unless --publish. The pushed tag
 * starts the Release workflow (.github/workflows/release.yml), which builds
 * every installer with --rebuild and creates the GitHub release with
 * github-release.
 *
 * With the updater's signing key in TAURI_SIGNING_PRIVATE_KEY (the Release
 * workflow has it), each desktop build that --rebuild makes also makes the
 * app's signed update, and github-release adds latest.json, which installed
 * apps read to update themselves (the README's "Desktop updates"). The
 * Android APK is always signed with the release key, from
 * BUDGETMINT_ANDROID_KEYSTORE and BUDGETMINT_ANDROID_KEYSTORE_PASSWORD (the
 * README's "Android signing").
 *
 * Run it in the main checkout, on main: `pnpm release --help`.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assetName,
  BUMPS,
  buildPlan,
  buildTargets,
  bumpVersion,
  bundlePath,
  cargoTomlName,
  cargoTomlVersion,
  DESKTOP_TARGETS,
  extractSection,
  highestBump,
  insertSection,
  isoDate,
  isTarget,
  missingAssets,
  packageJsonVersion,
  parseNote,
  releaseAssets,
  releaseDownloadUrl,
  renderSection,
  setCargoLockVersions,
  setCargoTomlVersion,
  setPackageJsonVersion,
  TARGETS,
  UPDATE_MANIFEST,
  updateAssetNames,
  updateBundlePaths,
  updateManifest,
  verifyApkSigner,
  verifyUpdateSignature,
} from './release/lib.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Every manifest that carries the shared version. */
const PACKAGE_JSONS = [
  'apps/desktop/package.json', // tauri.conf.json reads the app's version from here
  'apps/web/package.json',
  'packages/client/package.json', // Settings → About shows it
  'packages/contracts/package.json',
];
const CARGO_TOMLS = [
  'apps/desktop/src-tauri/Cargo.toml',
  'crates/budgetmint-core/Cargo.toml',
  'crates/budgetmint-wasm/Cargo.toml',
];
const CARGO_LOCK = 'Cargo.lock';
const CHANGELOG = 'CHANGELOG.md';
const CHANGES = 'changes';
const RELEASES = 'releases';
const TAURI_CONF = 'apps/desktop/src-tauri/tauri.conf.json';
/** Merged into tauri.conf.json for a build that makes updates (relative to apps/desktop, where Tauri runs). */
const UPDATER_CONFIG = 'src-tauri/tauri.updater.conf.json';
const RELEASE_WORKFLOW = 'release.yml';
/**
 * The Android project `tauri android build` builds (committed, with the
 * release signing in app/build.gradle.kts). Not made yet.
 */
const ANDROID_PROJECT = 'apps/desktop/src-tauri/gen/android';
/**
 * The SHA-256 of the release key's certificate (`keytool -list -v` shows it;
 * drop the colons). Every APK is signed with it, so each release installs
 * over the one before (the README's "Android signing").
 */
const ANDROID_SIGNER_SHA256 = 'f78ef45d507a3dd3b412ede0ed6175546eaeaf98e6cfaf20bac77027adf0fd79';
/**
 * The release key: a PKCS12 keystore with one key, alias `budgetmint`, and
 * its password (app/build.gradle.kts reads both).
 */
const ANDROID_KEY_ENV = ['BUDGETMINT_ANDROID_KEYSTORE', 'BUDGETMINT_ANDROID_KEYSTORE_PASSWORD'];

const USAGE = `Usage: pnpm release [options]
       pnpm release publish
       pnpm release github-release

Bumps the version by the highest change note in changes/, writes the
CHANGELOG section, then commits "Release X.Y.Z" and tags vX.Y.Z. It builds
nothing: the Release workflow builds the installers from the pushed tag.
Run it in the main checkout, on main.

With the updater's signing key in TAURI_SIGNING_PRIVATE_KEY, each desktop
build that --rebuild makes also makes the app's signed update (the README's
"Desktop updates"). android-arm64 needs the Android project
(apps/desktop/src-tauri/gen/android), the Android SDK, NDK and a JDK, and
the release key in BUDGETMINT_ANDROID_KEYSTORE (a PKCS12 file) and
BUDGETMINT_ANDROID_KEYSTORE_PASSWORD (the README's "Android signing").

Options:
  --dry-run              Print the next version and its section; change nothing
  --patch, --minor, --major
                         Bump this level instead of the notes' highest
  --publish              Then push main and the tag
  --rebuild              Only build the current version's installers into
                         releases/ (no bump, no commit): this computer's, or
                         the --target and --windows ones
  --target <name>        (With --rebuild) Build this instead of this computer's
                         installer; repeat it for more: ${TARGETS.join(', ')}
  --windows              (With --rebuild) Also build windows-x64 (on a Mac,
                         cross-compiled with cargo-xwin)
  -h, --help             Show this

publish                  Push main and the current version's tag. The tag starts
                         the Release workflow, which builds every installer and
                         creates the GitHub release.
github-release           (The Release workflow's last step) Create the current
                         version's GitHub release with its CHANGELOG section,
                         every installer and update in releases/ and the
                         latest.json made from them, or replace its files`;

class Stop extends Error {}
const stop = message => {
  throw new Stop(message);
};

// ── Shell ───────────────────────────────────────────────────────────────────

/**
 * Runs a command with its output shown; stops if it fails. On Windows, pnpm
 * is a .cmd shim, which only a shell runs: it gets the line as one string
 * (Node warns about args passed with a shell), and the words it's run with
 * need no quoting.
 */
function run(command, args, { cwd = root } = {}) {
  const line = [command, ...args].join(' ');
  console.log(`\n$ ${line}`);
  const result =
    process.platform === 'win32' && command === 'pnpm'
      ? spawnSync(line, { cwd, stdio: 'inherit', shell: true })
      : spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) stop(`${command}: ${result.error.message}`);
  if (result.status !== 0) stop(`${line} failed (exit ${result.status})`);
}

/** The pure parts' errors are the user's to fix, so they stop without a stack trace. */
function checked(fn) {
  try {
    return fn();
  } catch (error) {
    stop(error.message);
  }
}

/** A command's output; stops if it fails. */
function output(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.error) stop(`${command}: ${result.error.message}`);
  if (result.status !== 0) stop(`${command} ${args.join(' ')} failed:\n${result.stderr.trim()}`);
  return result.stdout.trim();
}

const git = (...args) => output('git', args);
const succeeds = (command, args) => spawnSync(command, args, { cwd: root, stdio: 'ignore' }).status === 0;
const read = file => readFileSync(join(root, file), 'utf8');
const write = (file, text) => writeFileSync(join(root, file), text);

// ── State ───────────────────────────────────────────────────────────────────

/** The shared version; stops unless every manifest agrees. */
function currentVersion() {
  const versions = [
    ...PACKAGE_JSONS.map(file => [file, packageJsonVersion(read(file), file)]),
    ...CARGO_TOMLS.map(file => [file, cargoTomlVersion(read(file), file)]),
  ];
  const distinct = new Set(versions.map(([, version]) => version));
  if (distinct.size !== 1) {
    stop(`The manifests disagree on the version:\n${versions.map(([file, v]) => `  ${v}  ${file}`).join('\n')}`);
  }
  return versions[0][1];
}

function changeNotes() {
  const dir = join(root, CHANGES);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith('.md') && name !== 'README.md')
    .sort()
    .map(name => {
      const file = `${CHANGES}/${name}`;
      return parseNote(file, read(file));
    });
}

const tagOf = version => `v${version}`;
const tagExists = tag => succeeds('git', ['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`]);
const productName = () => JSON.parse(read(TAURI_CONF)).productName;
/** The key installed apps check an update's signature with. */
const updaterPublicKey = () => JSON.parse(read(TAURI_CONF)).plugins.updater.pubkey;
/** Tauri signs updates with this key, so a build can make them. */
const signsUpdates = () => Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY);
const missingAndroidKey = () => ANDROID_KEY_ENV.filter(name => !process.env[name]);

function requireMainAndClean() {
  const branch = git('branch', '--show-current');
  if (branch !== 'main') stop(`Releases are cut on main (this is ${branch || 'a detached HEAD'}).`);
  const status = git('status', '--porcelain');
  if (status) stop(`Commit or set aside these changes first:\n${status}`);
}

// ── Steps ───────────────────────────────────────────────────────────────────

/** Every path a release changes: the manifests, the lock file, the CHANGELOG and the notes it deletes. */
const releasePaths = notes => [
  ...PACKAGE_JSONS,
  ...CARGO_TOMLS,
  CARGO_LOCK,
  CHANGELOG,
  ...notes.map(note => note.file),
];

/**
 * Writes the version everywhere and the CHANGELOG section, and deletes the
 * notes. Every file's new text is worked out first, so a problem with any of
 * them stops it before anything is written.
 */
function writeRelease(version, section, notes) {
  const crates = CARGO_TOMLS.map(file => cargoTomlName(read(file), file));
  const texts = [
    ...PACKAGE_JSONS.map(file => [file, setPackageJsonVersion(read(file), version, file)]),
    ...CARGO_TOMLS.map(file => [file, setCargoTomlVersion(read(file), version, file)]),
    [CARGO_LOCK, setCargoLockVersions(read(CARGO_LOCK), crates, version)],
    [CHANGELOG, insertSection(read(CHANGELOG), version, section)],
  ];
  for (const [file, text] of texts) write(file, text);
  for (const note of notes) rmSync(join(root, note.file));
}

/** Puts the touched paths back as HEAD has them. */
function restore(paths) {
  console.error('\nPutting the version, CHANGELOG and notes back as they were.');
  git('restore', '--source=HEAD', '--staged', '--worktree', '--', ...paths);
}

/** The targets to build and how this computer builds each; stops before anything is built if it can't. */
function planBuilds({ targets, windows }) {
  const host = { platform: process.platform, arch: process.arch };
  const plans = checked(() =>
    buildTargets({ targets, windows, ...host }).map(target => ({ target, ...buildPlan(target, host) }))
  );
  if (plans.some(plan => plan.kind === 'android')) requireAndroidRelease();
  return plans;
}

/** The APK needs the Android project, the release key and its certificate's SHA-256. */
function requireAndroidRelease() {
  if (!existsSync(join(root, ANDROID_PROJECT))) {
    stop(
      `${ANDROID_PROJECT} isn't there yet: make it with \`pnpm tauri android init\`, add the release signing to app/build.gradle.kts and commit it.`
    );
  }
  if (!ANDROID_SIGNER_SHA256) {
    stop(
      `ANDROID_SIGNER_SHA256 in scripts/release.mjs isn't set, so the APK's signer can't be checked (the README's "Android signing").`
    );
  }
  const missing = missingAndroidKey();
  if (missing.length > 0) {
    const isnt = missing.length > 1 ? "aren't" : "isn't";
    stop(
      `The APK is signed with the release key, but ${missing.join(' and ')} ${isnt} set (the README's "Android signing").`
    );
  }
}

/**
 * Builds each planned target and puts its files in releases/ (a desktop
 * target's update too, when the key is there to sign it); returns their
 * paths.
 */
function build(version, plans) {
  if (plans.length === 0) return [];
  mkdirSync(join(root, RELEASES), { recursive: true });
  const updates = signsUpdates();
  if (!updates && plans.some(plan => plan.kind === 'tauri' || plan.kind === 'xwin')) {
    console.log("\nTAURI_SIGNING_PRIVATE_KEY isn't set, so the desktop builds make no updates.");
  }
  // Every app runs core in its webview, so its wasm comes first (the
  // client's build imports it)
  run('pnpm', ['build:wasm']);
  return plans.flatMap(plan => {
    const destination = join(root, RELEASES, assetName(productName(), version, plan.target));
    if (plan.kind === 'android') {
      copyBuilt(buildApk(version, plan), destination);
      return [destination];
    }
    copyBuilt(buildInstaller(version, plan, updates), destination);
    return updates ? [destination, ...copyUpdate(version, plan)] : [destination];
  });
}

/** Builds a desktop installer with Tauri (and its update, with `updates`); returns where Tauri left it. */
function buildInstaller(version, plan, updates) {
  if (plan.triple) run('rustup', ['target', 'add', plan.triple]);
  const config = updates ? ['--config', UPDATER_CONFIG] : [];
  const cross = plan.triple ? ['--target', plan.triple] : [];
  // (cargo-xwin cross-compiles the Windows installer on a Mac)
  const runner = plan.kind === 'xwin' ? ['--runner', 'cargo-xwin'] : [];
  run('pnpm', ['--filter', '@budgetmint/desktop', 'tauri', 'build', ...cross, ...runner, ...config]);
  return bundlePath(productName(), version, plan.target, plan);
}

/**
 * Builds the APK with Tauri, signed with the release key, and checks it's
 * signed with the release certificate; returns where Gradle left it.
 */
function buildApk(version, plan) {
  run('rustup', ['target', 'add', plan.triple]);
  // Gradle's incremental packaging can keep bytes from an earlier build
  rmSync(join(root, ANDROID_PROJECT, 'app/build'), { recursive: true, force: true });
  run('pnpm', [
    '--filter',
    '@budgetmint/desktop',
    'tauri',
    'android',
    'build',
    '--apk',
    '--target',
    plan.tauriTarget,
    '--ci',
  ]);
  const apk = bundlePath(productName(), version, plan.target, plan);
  if (!existsSync(join(root, apk))) stop(`The build finished, but ${apk} isn't there.`);
  const output = spawnSync(apksigner(), ['verify', '--print-certs', join(root, apk)], { encoding: 'utf8' });
  if (output.error) stop(`apksigner: ${output.error.message}`);
  if (output.status !== 0) {
    stop(`apksigner says the APK isn't signed properly:\n${(output.stderr || output.stdout).trim()}`);
  }
  checked(() => verifyApkSigner({ output: output.stdout, digest: ANDROID_SIGNER_SHA256 }));
  return apk;
}

/** The newest released Build-Tools' apksigner in the Android SDK. */
function apksigner() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) stop("ANDROID_HOME (the Android SDK) isn't set.");
  const dir = join(sdk, 'build-tools');
  const byVersion = (a, b) => b.localeCompare(a, 'en', { numeric: true });
  // (not a preview like 36.0.0-rc5)
  const versions = existsSync(dir) ? readdirSync(dir).filter(name => /^[\d.]+$/.test(name)) : [];
  const tool = versions
    .sort(byVersion)
    .map(version => join(dir, version, 'apksigner'))
    .find(path => existsSync(path));
  if (!tool) stop(`There's no apksigner in ${dir}: install Build-Tools with the SDK Manager.`);
  return tool;
}

function copyBuilt(from, destination) {
  if (!existsSync(join(root, from))) stop(`The build finished, but ${from} isn't there.`);
  copyFileSync(join(root, from), destination);
}

/**
 * Puts a desktop target's update and its signature in releases/, once the
 * signature checks out against the key installed apps trust; returns their
 * paths. (Windows' update is its installer, already there.)
 */
function copyUpdate(version, plan) {
  const name = productName();
  const from = updateBundlePaths(name, version, plan.target, plan);
  const to = updateAssetNames(name, version, plan.target);
  for (const file of [from.file, from.signature]) {
    if (!existsSync(join(root, file))) stop(`The build finished, but ${file} isn't there.`);
  }
  checked(() =>
    verifyUpdateSignature({
      publicKey: updaterPublicKey(),
      signature: read(from.signature),
      data: readFileSync(join(root, from.file)),
    })
  );
  const copies = [[from.signature, to.signature]];
  if (to.file !== assetName(name, version, plan.target)) copies.unshift([from.file, to.file]);
  return copies.map(([source, file]) => {
    const destination = join(root, RELEASES, file);
    copyBuilt(source, destination);
    return destination;
  });
}

function commitAndTag(version, section, paths) {
  git('add', '--all', '--', ...paths);
  const body = section.split('\n').slice(1).join('\n').trim();
  run('git', ['commit', '--quiet', '-m', `Release ${version}`, '-m', body]);
  run('git', ['tag', '--annotate', tagOf(version), '-m', `${productName()} ${version}`]);
}

function reveal(files) {
  const dmg = files.find(file => file.endsWith('.dmg'));
  if (dmg && process.platform === 'darwin' && process.stdout.isTTY) spawnSync('open', ['-R', dmg]);
}

function report(files) {
  if (files.length === 0) return;
  console.log(`\nIn ${RELEASES}/:`);
  for (const file of files) console.log(`  ${relative(join(root, RELEASES), file)}`);
}

// ── Commands ────────────────────────────────────────────────────────────────

function release(options) {
  const current = currentVersion();
  const notes = changeNotes();
  const level = options.level ?? highestBump(notes);
  if (!level) {
    stop(`No change notes in ${CHANGES}/ (changes/README.md says how to write one).
To release without any, pass --patch, --minor or --major.`);
  }
  const version = bumpVersion(current, level);
  const section = renderSection(version, isoDate(new Date()), notes);

  if (options.dryRun) {
    console.log(`${current} → ${version} (${options.level ? `--${level}` : `${level}, from the notes`})`);
    if (notes.length > 0) console.log(`Notes: ${notes.map(note => note.file).join(', ')}`);
    console.log(`\n${section}`);
    return;
  }

  requireMainAndClean();
  if (tagExists(tagOf(version))) stop(`The tag ${tagOf(version)} already exists.`);

  console.log(`Releasing ${version} (${current} → ${version}, ${level})`);
  const paths = releasePaths(notes);
  const before = git('rev-parse', 'HEAD');
  try {
    writeRelease(version, section, notes);
    commitAndTag(version, section, paths);
  } catch (error) {
    // Once the release is committed, only the tag is missing
    if (git('rev-parse', 'HEAD') === before) restore(paths);
    throw error;
  }
  console.log(`\nCommitted "Release ${version}" and tagged ${tagOf(version)} (not pushed).`);
  if (options.publish) publish(version);
}

function rebuild(options) {
  const version = currentVersion();
  const plans = planBuilds(options);
  if (git('status', '--porcelain')) console.warn('The working tree has changes: the installers include them.');
  const files = build(version, plans);
  report(files);
  reveal(files);
}

/** Pushes main and the tag. The tag starts the Release workflow, which builds the installers and creates the GitHub release. */
function publish(version = currentVersion()) {
  const tag = tagOf(version);
  if (!tagExists(tag)) stop(`There's no tag ${tag}: release ${version} first.`);
  if (git('branch', '--show-current') !== 'main') stop('Publish from main.');
  if (extractSection(read(CHANGELOG), version) === null) stop(`CHANGELOG.md has no ${version} section.`);

  run('git', ['push', 'origin', 'main', tag]);
  console.log(`
Pushed main and ${tag}. The Release workflow builds every installer and
creates the GitHub release; follow it with:
  gh run list --workflow ${RELEASE_WORKFLOW}`);
}

/**
 * latest.json for the release: where each desktop update downloads from, its
 * signature (from releases/), and the version's notes.
 */
function writeUpdateManifest(version, notes, dir) {
  const repository = process.env.GH_REPO;
  if (!repository) stop('GH_REPO (owner/name) says where the release is; the Release workflow sets it.');
  const name = productName();
  const signatures = Object.fromEntries(
    DESKTOP_TARGETS.map(target => [
      target,
      readFileSync(join(dir, updateAssetNames(name, version, target).signature), 'utf8'),
    ])
  );
  const manifest = checked(() =>
    updateManifest({
      product: name,
      version,
      notes,
      pubDate: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      downloadUrl: releaseDownloadUrl(repository, version),
      signatures,
    })
  );
  const file = join(dir, UPDATE_MANIFEST);
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
}

/**
 * The Release workflow's last step: creates the GitHub release for the
 * checked-out tag with its CHANGELOG section, every target's file and
 * update from releases/ (the build jobs' artifacts) and latest.json, or
 * replaces the files of a release that already exists. A release is never
 * made with a file missing.
 */
function githubRelease(version = currentVersion()) {
  const tag = tagOf(version);
  const ref = process.env.GITHUB_REF_NAME;
  if (ref && ref !== tag) stop(`This run is for ${ref}, but the manifests say ${version}.`);
  if (!tagExists(tag)) stop(`There's no tag ${tag}.`);
  const notes = extractSection(read(CHANGELOG), version);
  if (notes === null) stop(`CHANGELOG.md has no ${version} section.`);

  const name = productName();
  const dir = join(root, RELEASES);
  const missing = missingAssets(name, version, existsSync(dir) ? readdirSync(dir) : []);
  if (missing.length > 0) stop(`${RELEASES}/ is missing ${missing.join(', ')}.`);
  const files = [
    ...releaseAssets(name, version).map(file => join(dir, file)),
    writeUpdateManifest(version, notes, dir),
  ];

  if (succeeds('gh', ['release', 'view', tag])) {
    run('gh', ['release', 'upload', tag, '--clobber', ...files]);
    return;
  }
  const notesFile = join(tmpdir(), `budgetmint-${version}-notes.md`);
  writeFileSync(notesFile, `${notes}\n`);
  try {
    run('gh', [
      'release',
      'create',
      tag,
      '--verify-tag',
      '--title',
      `${name} ${version}`,
      '--notes-file',
      notesFile,
      ...files,
    ]);
  } finally {
    rmSync(notesFile, { force: true });
  }
}

// ── Arguments ───────────────────────────────────────────────────────────────

function parseArgs(args) {
  const options = {
    dryRun: false,
    rebuild: false,
    windows: false,
    publish: false,
    level: null,
    targets: [],
  };
  let command = 'release';
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '-h' || arg === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === 'publish' || arg === 'github-release') command = arg;
    else if (arg === '--target' || arg.startsWith('--target=')) {
      const target = arg === '--target' ? args[++index] : arg.slice('--target='.length);
      if (!isTarget(target)) stop(`--target takes one of ${TARGETS.join(', ')}${target ? ` (not ${target})` : ''}.`);
      options.targets.push(target);
    } else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--rebuild') options.rebuild = true;
    else if (arg === '--windows') options.windows = true;
    else if (arg === '--publish') options.publish = true;
    else if (BUMPS.includes(arg.replace(/^--/, '')) && arg.startsWith('--')) {
      if (options.level) stop('Pass one of --patch, --minor and --major.');
      options.level = arg.slice(2);
    } else stop(`Unknown option ${arg}\n\n${USAGE}`);
  }
  if (command !== 'release' && args.length > 1) stop(`\`pnpm release ${command}\` takes no options.`);
  if (options.rebuild && (options.level || options.publish || options.dryRun)) {
    stop('--rebuild only takes --target and --windows.');
  }
  if (!options.rebuild && (options.windows || options.targets.length > 0)) {
    stop('--target and --windows go with --rebuild: a release builds nothing.');
  }
  return { command, options };
}

try {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'publish') publish();
  else if (command === 'github-release') githubRelease();
  else if (options.rebuild) rebuild(options);
  else release(options);
} catch (error) {
  console.error(`\n${error instanceof Stop ? error.message : error.stack}`);
  process.exit(1);
}
