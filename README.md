<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/logo-dark.png">
    <img src="assets/brand/logo.png" alt="BudgetMint" width="440">
  </picture>
</h1>

A bill tracker and cash-flow forecast for the desktop, Android and the web,
and TaskMint's companion. You list your bills and income, mark them paid or
received, and see your balance day by day, with TaskMint's upcoming
DataAnnotation withdrawals counted as income. Signed in with your TaskMint
account, every device shares the same budget through Firebase.

Built with Tauri v2, React, TypeScript and Rust, the same stack and design as
[TaskMint](https://github.com/BeardedUnicorn/taskmint).

## What it does

| Page | What it's for |
|---|---|
| **Overview** | Today's balance, what's safe to spend (above your low mark to the forecast's end, after everyday spending and what's set aside), the lowest point ahead, a warning for the first day it goes short (with what more TaskMint work would cover it, and by when), what's due this week, income over the next two weeks, TaskMint's next withdrawal, and the upcoming list (mark paid or received, skip, change an amount). Updating the balance checks it against what was expected. |
| **Bills** and **Income** | Recurring items: once, every N days, weeks, months (a day of the month, kept from the first date, so the 31st falls on the last day of shorter months), twice a month, a weekday of the month (the second Friday) or years, with weekend dates kept or moved to the Friday before or the Monday after. Autopay, a category, notes, reminders, an amount that varies (expected at the average of the last three paid), and a schedule that changes from a date on while earlier occurrences stay as they were. Archive what's finished; each item's history is a click away. |
| **Savings** | Money set aside a month at a time for a yearly or monthly bill, or a goal of your own by a date: how much is set aside for each, and the next part. |
| **Calendar** | Each day's bills, income and withdrawals, and the balance at the end of it, in red below your low-balance mark. Click a day for its details. |
| **Forecast** | The balance line over the next 14 to 366 days (and what's left of it besides the money set aside), with your low-balance mark, a day-by-day table, and the assumptions it rests on, everyday spending among them. |
| **Reports** | A month looked back on: bills paid against what was expected, by category; income and TaskMint's withdrawals; bills paid late; spending besides the bills; and the six months up to it. |
| **Settings** | Your account, your data (backups, a spreadsheet, and a bank statement imported as CSV or OFX to mark bills paid), the forecast's assumptions and everyday spending, TaskMint's connection, reminders on this device, appearance, privacy (on the web and Android: usage statistics) and (on the desktop) updates. |

**TaskMint's withdrawals.** TaskMint publishes a forecast of what each
withdrawal would take, and when the next one opens (only numbers: no task
names or notes). BudgetMint turns it into a series of withdrawals under your
policy (as soon as one opens, or weekly on a day and hour), with a minimum
withdrawal and the bank's delay. TaskMint's earnings only reach about a week
ahead, so further out it can assume earnings: a weekly amount, or your
average over the last few weeks. Assumed income is marked as such. Without
TaskMint, BudgetMint works as a plain bill tracker.

**Reminders** come the days before a bill is due (and when income should
arrive, and when the balance would go short), at the hour you choose:

- **The desktop** shows them while the app runs. Closing the window keeps it
  in the tray (the menu bar on macOS), which also shows today's balance and
  the lowest point ahead. Settings → Reminders → **Open BudgetMint at login**
  starts it in the tray when you log in, and the ones it missed while closed
  (in the last day) come when it opens.
- **The web app** shows them while a BudgetMint tab is open, and the ones it
  missed when it's opened again.
- **Android** sets them with the system, so they come with the app closed.

**The web app** is at [budgetmint.web.app](https://budgetmint.web.app). It
can be installed from the browser, and opens without a connection once it has been opened online: its
service worker keeps the app's own files, and Firestore keeps the budget.
[Privacy](https://budgetmint.web.app/privacy) and
[terms](https://budgetmint.web.app/terms) are pages of the site
(`apps/web/public/`).

## How it fits with TaskMint

BudgetMint has its own Firebase project, `budgetmint`, for its accounts and
data ([ADR 0003](docs/adr/0003-own-firebase-project.md)). Signing in also
signs in to TaskMint's project, `taskmint-f9a05`, with the same email and
password or Google account, only to read TaskMint's forecast. When the two
accounts differ, Settings → TaskMint signs in to TaskMint alone. BudgetMint
never makes a TaskMint account, and writes nothing in TaskMint's project.

BudgetMint's Firestore rules are its own (`rules/firestore.rules`), deployed
by its release. TaskMint owns its parts, and BudgetMint keeps pinned copies
for its tests:

- **TaskMint's Firestore rules** (`firebase/firestore.rules`), which the
  emulator test reads the forecast under.
- **The forecast contract** (`docs/taskmint/payout-forecast.md`) and its
  fixtures (`crates/budgetmint-core/src/testkit/taskmint/`).

`firebase/UPSTREAM.json` records the TaskMint commit they came from and each
file's hash. `pnpm upstream:check` (part of `pnpm verify`) fails if a copy
was edited here; `pnpm upstream:pull` copies them again from
`../taskmint-app` (or `--ref <sha>` from GitHub).

BudgetMint's data is at `budgetmint/{uid}` (its epoch) and
`budgetmint/{uid}/data/{kind~id}`, one document per setting, item or
occurrence you've acted on. In TaskMint's project it reads
`users/{uid}/published/payoutForecast`, with TaskMint's uid.
Deleting BudgetMint's data starts a new epoch, and the rules refuse writes
from an older one, so another device that's still open starts over instead
of writing the old data back. Deleting your BudgetMint account deletes its
data too, and only signs out of TaskMint.

## Development

**Prerequisites:** Node 24 and pnpm (the version in `package.json`'s
`packageManager`), Rust 1.93 with the `wasm32-unknown-unknown` target
(`rust-toolchain.toml` installs both), the `wasm-bindgen` CLI at the version
in `Cargo.lock` (`cargo install wasm-bindgen-cli --version 0.2.127`),
`cargo-llvm-cov` for the coverage gates, and Java 21 or later for the
Firestore emulator. Tauri's
[prerequisites](https://v2.tauri.app/start/prerequisites/) for the desktop.

```bash
pnpm install
```

```bash
pnpm build:wasm
```

`pnpm build:wasm` compiles `crates/budgetmint-core` to WebAssembly for the
client; every app runs it in the webview. Then:

```bash
pnpm tauri dev
```

```bash
pnpm --filter @budgetmint/web dev
```

The desktop's dev server is on port 1430 and the web app's on 1431, clear of
TaskMint's. A development build can keep its storage apart from the installed
app's with `BUDGETMINT_DATA_DIR=/some/folder pnpm tauri dev`.

**Emulators.** Copy `.env.example` to `.env` and set
`VITE_FIREBASE_EMULATOR_HOST=127.0.0.1`, then start the Auth and Firestore
emulators (the same ports as TaskMint's, so one set serves both apps' projects,
and one account signs in to both):

```bash
pnpm firebase --config firebase.emulators.json emulators:start --project budgetmint
```

**Gates.** `pnpm verify` runs every check CI does: the coverage policy,
toolchain pins, the upstream pin, the generated contracts, Biome, the
scripts' tests, BudgetMint's rules and its store against both projects' rules
on the emulator (`scripts/test-emulator.sh`), TypeScript, the builds, and the tests with
100% coverage in every TypeScript package, `budgetmint-core` and the desktop
shell. Exclusions are listed only in `coverage-policy.json`.

**Contracts.** `packages/contracts/src/generated` is generated from core's
Rust types (`crates/budgetmint-core/tests/contracts.rs`); after changing
them, run `scripts/check-contracts.sh` and commit the result.

### App icons

The masters are SVG, in `assets/brand/`: `icon.svg` (the app icon: coins and
TaskMint's leaf on TaskMint's tile), `mark.svg` (the leaf with a dollar
sign), `logo.svg` (the wordmark, set in Avenir Next Heavy) and
`tray-template.svg` (the menu-bar icon). `pnpm brand` renders them to
`assets/brand/*.png`, the menu-bar icon and `packages/client/public/` (macOS,
for the font). Then make the bundle icons, and replace the `.icns` with the
one on Apple's grid:

```bash
cd apps/desktop && pnpm tauri icon ../../assets/brand/icon.png
```

```bash
cd apps/desktop && pnpm tauri icon ../../assets/brand/icon-macos.png -o /tmp/budgetmint-icons && cp /tmp/budgetmint-icons/icon.icns src-tauri/icons/
```

`tauri icon` also writes sizes the bundle doesn't use; delete them again:

```bash
cd apps/desktop/src-tauri/icons && rm -rf android ios Square*Logo.png StoreLogo.png 64x64.png
```

The desktop's own wiring (`app.rs`, `platform/os.rs`) has no automated tests;
[docs/qa/excluded-code-checklist.md](docs/qa/excluded-code-checklist.md)
checks it by hand before a release, including an update from a local feed.
[docs/runbook.md](docs/runbook.md) covers deploying, rolling back and
incidents.

### Desktop updates

As TaskMint's: the app checks
`https://github.com/BeardedUnicorn/BudgetMint/releases/latest/download/latest.json`
at launch and daily (Settings → Updates checks now, or turns the automatic
check off). When that names a newer version, the app asks; on yes it
downloads the update, checks its signature, installs it and restarts. The
Rust side does this with `tauri-plugin-updater` (`src/platform/os.rs`,
`src/updates.rs`); the dialog and Settings → Updates are
`apps/desktop/src/updates.ts`, `UpdatePrompt.tsx` and
`settings/UpdatesSection.tsx`. A development build checks but won't install.

Updates are signed with BudgetMint's own minisign key (not TaskMint's):

- The public key is `plugins.updater.pubkey` in
  `apps/desktop/src-tauri/tauri.conf.json`. The private key is
  `~/.tauri/budgetmint-updater.key` on the computer that made it; it and its
  password go in the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, which only the Release workflow's
  build step sees.
- **Keep a copy of the private key and its password** away from this
  computer (a password manager). Without them, no later release can update
  the installed apps.
- **A new key** (lost or leaked):
  `pnpm --filter @budgetmint/desktop tauri signer generate -w ~/.tauri/budgetmint-updater.key`,
  then replace both secrets and `plugins.updater.pubkey`, and release.
  Installed apps can't verify an update signed with the new key, so that
  release is installed by hand once.

### Android

The desktop crate also builds as a Tauri Android app (`apps/desktop`, the
same Rust and webview), package `com.budgetmint.android`
(`tauri.android.conf.json` sets it; the desktop app stays
`com.budgetmint.desktop`). Each release has
`BudgetMint-X.Y.Z-android-arm64.apk` for arm64 phones, every phone from
roughly the last eight years.

**Installing it.** Open the release on the phone and download the APK.
Opening it asks you to let the browser (or Files) install unknown apps;
allow it, go back and install. A later release's APK installs the same way,
over the app, and keeps its data: they're all signed with the same key (see
[Android signing](#android-signing)). The app doesn't update itself.

**Prerequisites**, besides the ones above:

- Android Studio, or the command-line tools, with SDK Manager's Android SDK
  Platform, Platform-Tools, Build-Tools, Command-line Tools and NDK (Side by
  side), 29.0.13599879 as the Release workflow's.
- JDK 17 or later; Android Studio's own works
  (`/Applications/Android Studio.app/Contents/jbr/Contents/Home` on macOS,
  which is 21, so the Firestore emulator can use it too).
- `JAVA_HOME`, `ANDROID_HOME` (usually `~/Library/Android/sdk`) and
  `NDK_HOME` (`$ANDROID_HOME/ndk/<version>`) set in your shell.
- The Rust Android targets. `tauri android init` installs them; by hand:

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

The Android project, `apps/desktop/src-tauri/gen/android`, is committed. It
was made by `pnpm tauri android init` from `tauri.conf.json` and
`tauri.android.conf.json`, and changed as TaskMint's is, in these places
(each marked `BudgetMint:`):

- `app/build.gradle.kts` signs release builds with the release key when
  `BUDGETMINT_ANDROID_KEYSTORE` and `BUDGETMINT_ANDROID_KEYSTORE_PASSWORD`
  are set ([Android signing](#android-signing)). Without them a release
  build is unsigned.
- Firebase: `app/google-services.json` (the "BudgetMint Android" app's
  public config, in the `budgetmint` project), the `google-services` Gradle
  plugin (in the root `build.gradle.kts`, applied in `app/build.gradle.kts`),
  and the Firebase BoM with Analytics, Credential Manager and googleid as
  dependencies. Firebase and googleid need Kotlin 2.3, which the root
  `build.gradle.kts` and `buildSrc/build.gradle.kts` pin.
- `MainActivity.kt` gives the webview four bridges (`tauriShell.ts` uses
  them): `BudgetMintSplash` (the launch screen stays until the app has
  drawn), `BudgetMintSystemBars` (the status bar follows the app's theme),
  `BudgetMintGoogleSignIn` (Credential Manager's Google sign-in) and
  `BudgetMintAnalytics` (Firebase Analytics, and its off switch).
  `app/proguard-rules.pro` keeps them, and Credential Manager's Play
  services provider, through R8.
- The manifest asks for exact alarms (`USE_EXACT_ALARM`, and
  `SCHEDULE_EXACT_ALARM` on Android 12), so a bill's reminder comes at its
  hour.
- The launch screen is androidx `core-splashscreen`'s, themed by
  `Theme.budgetmint.Starting` (`values/themes.xml`, and `values-v31` for the
  wordmark, which Android 12 and later show): the leaf on the app icon's
  teal. `MainActivity` keeps it up until the page calls
  `BudgetMintSplash.hide()` (or 10 s pass), then fades it out. Its images,
  `drawable-*/splash_icon.png` and `splash_branding.png`, come from
  `assets/brand/mark.png` and `logo-dark.png`. After changing those, make
  them again (macOS):

```bash
swift scripts/brand/android-splash.swift
```

- The launcher icons in `app/src/main/res` (`mipmap-*`, and the adaptive
  icon's background in `values/ic_launcher_background.xml`) come from
  `assets/brand/icon-macos.png`. Its padding keeps the coins and leaf inside
  the circle a launcher crops to, and the background is the tile's colour,
  so no edge shows. After changing the icon, make them again and copy
  `android/` over `res`:

```bash
cd apps/desktop && pnpm tauri icon ../../assets/brand/icon-macos.png --ios-color '#0A3A3E' -o /tmp/budgetmint-icons && cp -R /tmp/budgetmint-icons/android/. src-tauri/gen/android/app/src/main/res/
```

Tauri writes its per-build files into the project (they're gitignored), so a
fresh checkout builds without an `init`. A Tauri upgrade can change the
template: `tauri android init` in a scratch copy shows what's new.

Run it in an emulator or on a phone plugged in over USB, or build a debug
APK:

```bash
cd apps/desktop && pnpm tauri android dev
```

```bash
cd apps/desktop && pnpm tauri android build --debug --apk --target aarch64
```

For a phone on the network, `pnpm tauri android dev --host` serves Vite on
this computer's network address (`vite.config.ts` reads `TAURI_DEV_HOST`;
`tauri.android.conf.json` lets live reload connect to it). With the
emulators, set `VITE_FIREBASE_EMULATOR_HOST=10.0.2.2`: the Android
emulator's address for this computer.

On Android the Rust side reports the runtime `mobile` (`get_capabilities`).
The app has the budget, reminders as system alarms (they come with the app
closed), Google sign-in and usage analytics. Google sign-in needs Google
Play services, and the build's signing certificate registered on the
"BudgetMint Android" app (Firebase console → Project settings → Your apps):
the debug key's and the release key's SHA-1 and SHA-256 are. A new key needs
its own, and `google-services.json` downloaded again. The ID token is for
`budgetmint`'s web client, which TaskMint's project safelists, so it signs
in to both. The parts only a desktop has are left out, in the Rust
(`#[cfg(desktop)]`, and those crates are desktop-only dependencies) and in
the webview (`tauriShell.ts`, `extensions.tsx`): the tray, opening at login
and updates. Settings → Your data's backup and spreadsheet are saved through
Android's file picker, which picks a document (a `content://` address)
rather than a path: `tauri-plugin-fs`, a mobile-only dependency, opens it
(`platform/os.rs`).

To check the Rust compiles for Android without the Gradle build, point Cargo
at the NDK's compiler (the `tauri android` commands do this themselves):

```bash
TC=$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin CC_aarch64_linux_android=$TC/aarch64-linux-android24-clang AR_aarch64_linux_android=$TC/llvm-ar cargo clippy -p budgetmint --target aarch64-linux-android -- -D warnings
```

### Android signing

Android installs an APK over the app only when both are signed with the same
key, so every release's APK is signed with one release key: a PKCS12
keystore with one key, alias `budgetmint`, whose password is the
keystore's. It's `~/.android/budgetmint-release.p12` on the computer that
made it, with its password in `~/.android/budgetmint-release.password`. The
keystore (base64) and its password are the repository secrets
`ANDROID_KEYSTORE` and `ANDROID_KEYSTORE_PASSWORD`; the build reads them as
`BUDGETMINT_ANDROID_KEYSTORE` and `BUDGETMINT_ANDROID_KEYSTORE_PASSWORD`,
and `pnpm release --rebuild` checks the APK's certificate against
`ANDROID_SIGNER_SHA256` in `scripts/release.mjs`.

- **Keep a copy of the keystore and its password** away from this computer
  (a password manager). An APK signed with another key won't install over
  the app.
- **A release APK on this computer:**

```bash
BUDGETMINT_ANDROID_KEYSTORE=~/.android/budgetmint-release.p12 BUDGETMINT_ANDROID_KEYSTORE_PASSWORD="$(cat ~/.android/budgetmint-release.password)" pnpm release --rebuild --target android-arm64
```

- **A new key** (lost or leaked):
  `keytool -genkeypair -storetype PKCS12 -alias budgetmint -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=BudgetMint" -keystore <file>`,
  then replace both secrets, set `ANDROID_SIGNER_SHA256` to its SHA-256
  (`keytool -list -v`, without the colons), register its SHA-1 and SHA-256
  on the Firebase Android app and download `google-services.json` again.
  Installed apps can't take an APK signed with the new key: each phone
  uninstalls BudgetMint and installs the new one (the budget is in the
  cloud, so nothing is lost but the device's own settings).

### Releases

Change notes go in `changes/` ([changes/README.md](changes/README.md));
`pnpm release` turns them into the next CHANGELOG section and version,
commits and tags. Pushing the `vX.Y.Z` tag runs the Release workflow, which
builds the macOS and Windows apps with their signed updates and
`latest.json`, the Android APK, and the web app, then creates the GitHub
release with `SHA256SUMS`, every file's checksum (`sha256sum -c
--ignore-missing SHA256SUMS` checks a download).

**The web app**, as TaskMint's: once every build has passed, a tag deploys
BudgetMint's Firestore rules (`rules/firestore.rules`), then the web app, to
its project `budgetmint`. The GitHub release doesn't wait for the deploy, and
a failed deploy can be re-run on its own. The deploy signs in to Google
without a stored key ("Firebase setup" below says how), and
[docs/runbook.md](docs/runbook.md) says how to deploy by hand and how to roll
back.

The installers aren't signed (the Mac app is signed ad hoc), as TaskMint's
aren't. The first time a downloaded build is opened, macOS says it can't
verify BudgetMint: open System Settings → Privacy & Security and click
**Open Anyway**. On Windows, SmartScreen says it protected the PC: click
**More info**, then **Run anyway**.

## Firebase setup

The project `budgetmint` (Spark plan) has the "BudgetMint web",
"BudgetMint desktop" and "BudgetMint Android" apps (the Android one with
the debug and release keys' fingerprints), Firestore in nam5, the Hosting
site `budgetmint` and Google Analytics, and:

- **Auth:** Email/Password and Google. Its Google provider safelists the
  "BudgetMint desktop" OAuth client, which is in `taskmint-f9a05`'s
  Credentials and is what the desktop signs in to both projects with. In
  `taskmint-f9a05`, the Google provider safelists `budgetmint`'s web client
  ("Web client (auto created by Google Service)"), so the web's Google
  sign-in also signs in to TaskMint. Its authorized domains include
  `budgetmint.web.app` and `budgetmint.firebaseapp.com`, for Settings'
  Google sign-in to TaskMint. The desktop's client comes from `.env` locally
  and from the repository secrets `VITE_GOOGLE_DESKTOP_CLIENT_ID` / `_SECRET`
  in a release. A build without them hides Continue with Google (a
  development build says so in the console), and a release tag's build
  stops.
- **Deploys:** the Workload Identity pool `github`, with the provider
  `budgetmint-releases`. It takes only GitHub's tokens for this repository
  (by its id), on a `v*` tag, from `release.yml`. It can act as
  `github-deploy@budgetmint.iam.gserviceaccount.com`, which has no key and
  only Firebase Hosting Admin, Firebase Rules Admin and Service Usage
  Consumer (firebase-tools checks the APIs are on). The repository
  variables `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_DEPLOY_SERVICE_ACCOUNT`
  name them. Without them, a release skips the web deploy.

## Repository layout

```
crates/budgetmint-core/     every budget rule, pure Rust: recurrence, settlement, TaskMint's withdrawals, the forecast, reminders
crates/budgetmint-wasm/     core for the webview (wasm-bindgen)
packages/contracts/         TypeScript types generated from core
packages/client/            the React app every shell runs
apps/desktop/               the Tauri shell (desktop and Android) and its entry
apps/web/                   the web app's entry, its public files and service worker, for Firebase Hosting
rules/                      BudgetMint's Firestore rules and their tests
firebase/                   TaskMint's rules, pinned (UPSTREAM.json), for the tests
docs/                       ADRs, and TaskMint's forecast contract (pinned)
assets/brand/               the icon, mark, wordmark and tray icon masters
scripts/                    verify, wasm build, contracts, upstream pin, brand, release
```

## License

[MIT](LICENSE)
