#!/usr/bin/env node
/**
 * Starts an APK on a phone or emulator and checks it's still up afterwards:
 *
 *   pnpm android:smoke <apk> [--serial <adb serial>] [--package <name>] [--wait <seconds>]
 *
 * It installs the APK over the app that's there (keeping its data), starts
 * it, waits (15 seconds unless --wait says otherwise, which is past the
 * update check at 10), and fails if the app has gone or has left a crash in
 * the phone's crash log since the start (verifyApkLaunch in release/lib.mjs,
 * which has the tests).
 *
 * Run it on the release build: that's the minified one. A dev build keeps
 * every class, so it starts fine where a release can lose one a library
 * looks up by name and close before its first screen, as 2.9.0 did. The
 * Release workflow runs this on an emulator before it publishes an APK, and
 * `pnpm release --rebuild --target android-arm64` does on a connected phone
 * or emulator.
 *
 * The package is tauri.android.conf.json's identifier unless --package names
 * another (com.budgetmint.android.dev, for a build of the dev environment).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { verifyApkLaunch } from './release/lib.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const TAURI_ANDROID_CONF = 'apps/desktop/src-tauri/tauri.android.conf.json';

class Stop extends Error {}
const stop = message => {
  throw new Stop(message);
};

/**
 * Starts `apk` (the app `name`) on the device `serial` (adb's only one when
 * it's undefined) and throws if it doesn't stay up for `wait` seconds.
 */
export function smoke({ apk, name, serial, wait = 15 }) {
  const adb = (args, { allowFailure = false } = {}) => {
    const result = spawnSync('adb', [...(serial ? ['-s', serial] : []), ...args], { encoding: 'utf8' });
    if (result.error) stop(`adb: ${result.error.message} (it's in the Android SDK's platform-tools)`);
    if (result.status !== 0 && !allowFailure) {
      stop(`adb ${args.join(' ')} failed:\n${(result.stderr || result.stdout).trim()}`);
    }
    return result.stdout;
  };

  console.log(`Installing ${apk}`);
  adb(['install', '-r', apk]);
  // The crash log is read from here on, so an earlier crash doesn't count
  const since = adb(['shell', 'date', "+'%m-%d %H:%M:%S.000'"]).trim();
  adb(['shell', 'am', 'force-stop', name]);
  const activity = adb([
    'shell',
    'cmd',
    'package',
    'resolve-activity',
    '--brief',
    '-c',
    'android.intent.category.LAUNCHER',
    name,
  ])
    .trim()
    .split('\n')
    .at(-1)
    .trim();
  if (!activity.includes('/')) stop(`${name} has no launcher activity on the device: ${activity}`);
  console.log(`Starting ${activity}, then waiting ${wait} seconds`);
  // (a start that crashes still exits 0, or not, by Android version)
  adb(['shell', 'am', 'start', '-W', '-n', activity], { allowFailure: true });
  spawnSync('sleep', [String(wait)]);
  const pid = adb(['shell', 'pidof', name], { allowFailure: true });
  const crashLog = adb(['logcat', '-d', '-b', 'crash', '-T', since]);
  try {
    verifyApkLaunch({ name, pid, crashLog });
  } catch (error) {
    stop(error.message);
  }
  console.log(`${name} is still running, with no crash.`);
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { serial: { type: 'string' }, package: { type: 'string' }, wait: { type: 'string' } },
  });
  const [apk] = positionals;
  if (!apk || positionals.length > 1) {
    stop('Usage: pnpm android:smoke <apk> [--serial <adb serial>] [--package <name>] [--wait <seconds>]');
  }
  if (!existsSync(apk)) stop(`${apk} isn't there.`);
  const wait = Number(values.wait ?? 15);
  if (!Number.isInteger(wait) || wait < 1) stop(`--wait is a number of seconds, not "${values.wait}".`);
  const name = values.package ?? JSON.parse(readFileSync(`${root}/${TAURI_ANDROID_CONF}`, 'utf8')).identifier;
  smoke({ apk, name, serial: values.serial, wait });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    console.error(`\n${error.message}`);
    process.exit(1);
  }
}
