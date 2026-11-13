# ADR 0005: A dev environment for every build that isn't a release

- **Status:** accepted (2026-11-12)
- **Scope:** which Firebase projects a build uses, and how a test build
  installs beside the real app on the desktop and Android
- **Adapted from:** TaskMint's ADR 0004 (TaskMint 8b486ac), whose follow-up
  "BudgetMint dev builds reading taskmint-dev" this is

## Context

Every build used the production projects, BudgetMint's `budgetmint` and
TaskMint's `taskmint-f9a05` ([ADR 0003](0003-own-firebase-project.md)). That
included `pnpm tauri dev`, `tauri build --debug`, Android builds and the web
dev server. The configs were literals in the apps' `firebaseConfig.ts` and in
Android's `google-services.json`. Only a development build could use the
emulators, so a built app couldn't be tried without real accounts and data.

A desktop test build was also the installed app, `com.budgetmint.desktop`. It
shared that app's data folder, webview storage, single-instance lock,
`budgetmint://` scheme and update feed.

TaskMint has had a dev project, `taskmint-dev`, since its 4.4.1.

## Decisions

1. **A second Firebase project, `budgetmint-dev`.** It mirrors production:
   - Spark, with billing off;
   - email and Google sign-in, with email enumeration protection;
   - Firestore `(default)` in nam5, with the same rules;
   - Hosting at https://budgetmint-dev.web.app.

   It has no Analytics. It has the same three app registrations ("BudgetMint
   web", "BudgetMint desktop", and "BudgetMint Android" as
   `com.budgetmint.android.dev`).
2. **Each environment is a pair.** Production is `budgetmint` with TaskMint's
   `taskmint-f9a05`; dev is `budgetmint-dev` with TaskMint's `taskmint-dev`.
   A dev build never signs in to a production project, TaskMint's included.
   ADR 0003's rules hold for the dev pair too: BudgetMint makes no TaskMint
   account and writes nothing in `taskmint-dev`.
3. **One switch, `BUDGETMINT_ENV`.** It is `production` or `dev`, and unset
   means `dev`. Any other value stops the build. Every tool a build runs
   reads it from the same environment, which the Tauri CLI passes on:
   - Vite (`scripts/environment.mjs`'s plugin): the Firebase configs, the
     page's title, and a `dist/environment.json` marker;
   - Cargo (`build.rs` → `src/environment.rs`);
   - Gradle (`app/build.gradle.kts`).
4. **Dev is the default.** Only the release path sets `production`:
   `scripts/release.mjs` for its builds, and the release workflow's web job.
   Forgetting a flag gives a dev build, never a production one.
5. **A dev build is a separate app.**
   - **Desktop.** `tauri.conf.json` is the dev build: "BudgetMint Dev",
     `com.budgetmint.desktop.dev`, `budgetmint-dev://`, and no update feed.
     `tauri.production.conf.json`, which only `release.mjs` applies, makes a
     build the real app.
   - **Android.** Gradle adds `.dev` to the application ID and labels the app
     "BudgetMint Dev". It copies the environment's
     `app/firebase/google-services.<env>.json` into place and deactivates
     Analytics. The code's package stays `com.budgetmint.android`, which the
     Rust side's JNI names depend on.
   - **Web.** A dev build is titled "BudgetMint Dev" and counts nothing: the
     dev project has no Google Analytics stream.
6. **Mixed builds don't run, and wrong ones don't ship.**
   - **Desktop start-up.** A production build refuses to run as anything but
     `com.budgetmint.desktop`, and a dev build refuses to run as it
     (`Environment::check_identifier`).
   - **Release builds.** `release.mjs` checks that each build's webview
     marker says production, that the Mac app's `CFBundleIdentifier` is the
     real one, and that the APK's package is.
   - **Hosting.** Hosting's predeploy step
     (`scripts/check-web-environment.mjs`) refuses a `dist` built for another
     project than the one it's deploying to.
7. **Google sign-in in dev uses the same clients' pattern as production.**
   - The desktop signs in with production's "BudgetMint desktop" OAuth
     client, which both dev projects safelist, so the same `.env` and
     repository secrets work.
   - The web and Android apps' ID tokens are for `budgetmint-dev`'s own web
     client, which `taskmint-dev` safelists. The dev Android app has the
     debug and release keys' SHA-1s.
   - `taskmint-dev`'s authorized domains include `budgetmint-dev`'s, for
     Settings → TaskMint's Google sign-in on the web.
8. **Dev deploys are local.** `pnpm deploy:dev` deploys the rules and the web
   app from a developer's machine. The release workflow's Workload Identity
   trust stays production's only, and there's no CI workflow for dev builds.

## Consequences

- A test build can run beside the installed BudgetMint. Its data, settings,
  Firebase sign-in, logs and notification permissions are its own, and on
  Android it's an app of its own.
- `.firebaserc`'s default is the dev project, so a bare `pnpm firebase …`,
  emulators included, works on dev. Production commands name
  `--project budgetmint`, and `firebase.json` names no Hosting site: each
  project's default site is used.
- Hosting's CSP `frame-src` lists both environments' auth domains, since the
  file is shared.
- Building production by hand takes both halves: `BUDGETMINT_ENV=production`
  and `--config src-tauri/tauri.production.conf.json`.
- A setting changed in production's Authentication needs the same change in
  dev's, in both apps' projects.
- Trying the forecast end to end takes a TaskMint dev build too: TaskMint Dev
  publishes the forecast to `taskmint-dev` for the account that BudgetMint
  Dev signs in with.
- Cargo rebuilds the desktop crate when `BUDGETMINT_ENV` changes.
- **Not done here** (follow-ups if they're needed):
  - a distinct dev app icon;
  - a CI workflow for dev builds.
