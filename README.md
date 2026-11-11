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
| **Overview** | Today's balance and the lowest point ahead, a warning for the first day it goes short, what's due this week, income over the next two weeks, TaskMint's next withdrawal, and the upcoming list (mark paid or received, skip, change an amount). |
| **Bills** and **Income** | Recurring items: once, every N days, weeks, months (a day of the month, kept from the first date, so the 31st falls on the last day of shorter months) or years. Autopay, a category, notes, reminders, and a schedule that changes from a date on while earlier occurrences stay as they were. Archive what's finished; each item's history is a click away. |
| **Calendar** | Each day's bills, income and withdrawals, and the balance at the end of it, in red below your low-balance mark. Click a day for its details. |
| **Forecast** | The balance line over the next 14 to 366 days, with your low-balance mark, a day-by-day table, and the assumptions it rests on. |
| **Settings** | Your account, the forecast's assumptions, TaskMint's connection, reminders on this device, appearance, and (on the desktop) updates. |

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

- **Android** sets them with the system, so they come with the app closed.
- **The desktop** shows them while the app runs. Closing the window keeps it
  in the tray (the menu bar on macOS), which also shows today's balance and
  the lowest point ahead.
- **The web app** shows them while a BudgetMint tab is open.

## How it fits with TaskMint

Both apps use the Firebase project `taskmint-f9a05`, so one account signs in
to both. TaskMint owns the shared parts, and BudgetMint keeps pinned copies:

- **The Firestore rules** (`firebase/firestore.rules`) cover both apps.
  TaskMint's release deploys them; BudgetMint's deploys only its Hosting site.
- **The forecast contract** (`docs/taskmint/payout-forecast.md`) and its
  fixtures (`crates/budgetmint-core/src/testkit/taskmint/`).

`firebase/UPSTREAM.json` records the TaskMint commit they came from and each
file's hash. `pnpm upstream:check` (part of `pnpm verify`) fails if a copy
was edited here; `pnpm upstream:pull` copies them again from
`../taskmint-app` (or `--ref <sha>` from GitHub).

BudgetMint's data is at `budgetmint/{uid}` (its epoch) and
`budgetmint/{uid}/data/{kind~id}`, one document per setting, item or
occurrence you've acted on. It reads TaskMint's
`users/{uid}/published/payoutForecast` and never writes under `users/`.
Deleting BudgetMint's data starts a new epoch, and the rules refuse writes
from an older one, so another device that's still open starts over instead
of writing the old data back. Deleting your account is TaskMint's to do while
TaskMint has data on it; TaskMint's Delete account removes BudgetMint's data
too.

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
emulators (the same ports as TaskMint's, so one set serves both apps):

```bash
pnpm firebase --config firebase.emulators.json emulators:start --project taskmint-f9a05
```

**Gates.** `pnpm verify` runs every check CI does: the coverage policy,
toolchain pins, the upstream pin, the generated contracts, Biome, the
scripts' tests, BudgetMint's writes against TaskMint's rules on the emulator
(`scripts/test-emulator.sh`), TypeScript, the builds, and the tests with
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
(`tauri.android.conf.json`). The Android project
(`apps/desktop/src-tauri/gen/android`) isn't made yet: `pnpm tauri android
init`, then MainActivity's bridges as TaskMint's (`BudgetMintSplash`,
`BudgetMintSystemBars`, `BudgetMintGoogleSignIn`, see
`apps/desktop/src/tauriShell.ts`) and the launcher icons from
`assets/brand/icon-macos.png`. TaskMint's README lists the prerequisites
(Android Studio's SDK and NDK, JDK 17 or later, `JAVA_HOME`, `ANDROID_HOME`,
`NDK_HOME`). Until then a release ships no APK
(`RELEASE_TARGETS` in `scripts/release/lib.mjs`, and the Release workflow's
matrix).

### Android signing

Android installs an APK over the app only when both are signed with the same
key, so every release's APK will be signed with one release key: a PKCS12
keystore with one key, alias `budgetmint`, whose password is the
keystore's. The keystore (base64) and its password go in the repository
secrets `ANDROID_KEYSTORE` and `ANDROID_KEYSTORE_PASSWORD`; the build reads
them as `BUDGETMINT_ANDROID_KEYSTORE` and
`BUDGETMINT_ANDROID_KEYSTORE_PASSWORD`, and checks the APK's certificate
against `ANDROID_SIGNER_SHA256` in `scripts/release.mjs` (empty until the key
exists). Keep a copy of the keystore and its password away from this
computer: an APK signed with another key won't install over the app.

### Releases

Change notes go in `changes/` ([changes/README.md](changes/README.md));
`pnpm release` turns them into the next CHANGELOG section and version,
commits and tags. Pushing the `vX.Y.Z` tag runs the Release workflow, which
builds the macOS and Windows apps with their signed updates and
`latest.json`, and the web app, and creates the GitHub release.

## Firebase setup still to do

BudgetMint runs on the project now, as TaskMint's apps' Firebase web apps.
Before a public release it needs its own registrations in `taskmint-f9a05`
(each a one-time step in the Firebase or Google Cloud console):

1. **Apps:** "BudgetMint web" (linked to a new Hosting site `budgetmint`),
   "BudgetMint desktop", and Android `com.budgetmint.android` with its signing
   certificates. Then put their `appId`s in `apps/web/src/firebaseConfig.ts`
   and `apps/desktop/src/firebaseConfig.ts`.
2. **Auth:** add `budgetmint.web.app` and `budgetmint.firebaseapp.com` to the
   authorized domains, and create a "Desktop app" OAuth client for the
   desktop's Google sign-in (`.env` and the repository secrets
   `VITE_GOOGLE_DESKTOP_CLIENT_ID` / `_SECRET`).
3. **Deploys:** a Workload Identity Federation provider that trusts only this
   repository's `v*` tags, and a service account with Firebase Hosting Admin
   only (it must not be able to deploy rules). Set the repository variables
   `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_DEPLOY_SERVICE_ACCOUNT`; until
   then a release skips the web deploy.
4. **The Android app** (`pnpm tauri android init`, then MainActivity's
   bridges as TaskMint's: `BudgetMintSplash`, `BudgetMintSystemBars`,
   `BudgetMintGoogleSignIn`) and its release keystore.

## Repository layout

```
crates/budgetmint-core/     every budget rule, pure Rust: recurrence, settlement, TaskMint's withdrawals, the forecast, reminders
crates/budgetmint-wasm/     core for the webview (wasm-bindgen)
packages/contracts/         TypeScript types generated from core
packages/client/            the React app every shell runs
apps/desktop/               the Tauri shell (desktop and Android) and its entry
apps/web/                   the web app's entry, for Firebase Hosting
firebase/                   TaskMint's rules, pinned (UPSTREAM.json)
docs/                       ADRs, and TaskMint's forecast contract (pinned)
assets/brand/               the icon, mark, wordmark and tray icon masters
scripts/                    verify, wasm build, contracts, upstream pin, brand, release
```

## License

[MIT](LICENSE)
