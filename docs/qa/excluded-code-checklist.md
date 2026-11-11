# Excluded-code QA checklist

The coverage gate leaves out the files listed below
([coverage-policy.json](../../coverage-policy.json),
[docs/coverage-policy.md](../coverage-policy.md)). They need a real event
loop, a UI session or an OS prompt, so no test runs them. By rule they only
make calls, and every decision lives in tested code. That leaves the calls
themselves, which this checklist checks by hand.

Run it before a release, and after any change to one of these files, to the
Tauri or plugin versions, or to the `Platform` trait they implement.

| File | What it does | Section |
|---|---|---|
| `apps/desktop/src-tauri/src/app.rs` | the Tauri builder: plugins, setup, the window, the tray's clicks, the reminders' thread, the run loop | [Startup and wiring](#startup-and-wiring-apprs) |
| `apps/desktop/src-tauri/src/platform/os.rs` | `TauriPlatform`: events, notifications, the browser, the window, the tray, opening at login, the updater | [The platform](#the-platform-platformosrs), [Updates](#updates-platformosrs) |
| `apps/desktop/src-tauri/src/main.rs` | calls `budgetmint_lib::run`; no console window on Windows | [Windows](#windows) |
| BudgetMint against the real Firebase project | the tested store and session, on Google's servers and in real webviews | [The cloud](#the-cloud) |

## Before you start

- **Quit the installed BudgetMint.** A development build shares its
  single-instance lock and its webview storage.
- **Use a dev build with its own storage for most of this:**
  `BUDGETMINT_DATA_DIR=$HOME/tmp/budgetmint-qa pnpm tauri dev`.
- **Google sign-in needs BudgetMint's desktop OAuth client** in `.env`
  (`.env.example`); without it the sign-in page has no Google button.

Note anything that fails with the build, the OS version and what you saw.

## Startup and wiring (app.rs)

- [ ] **Launch.** The window opens on the sign-in page, or on the Overview
      when signed in, and the tray icon appears with Open BudgetMint and Quit.
- [ ] **Second launch.** Launching again while it runs brings the first
      window forward instead of opening another.
- [ ] **Close to the tray.** Closing the window hides it; the tray's Open
      BudgetMint (or double-clicking the icon, or the Dock icon on macOS)
      brings it back. Quit BudgetMint quits.
- [ ] **The tray's lines.** Signed in with a balance, the tray menu shows
      today's balance, the next bill and the lowest point ahead. Marking a
      bill paid changes them.
- [ ] **A reminder while it runs.** Add a bill due today with a reminder on
      the day, and set Settings → Reminders → At to the next hour (or change
      the system clock). With the window closed to the tray, the notification
      comes at that time, once. Clicking it opens the window.
- [ ] **A reminder missed while closed.** Quit BudgetMint before a reminder's
      time and open it after (within a day): the reminder comes at launch,
      worded as of now ("is due today", "was due yesterday"), and only once.
- [ ] **Open at login.** Turn on Settings → Reminders → Open BudgetMint at
      login, log out and in: BudgetMint runs in the tray without its window,
      and reminders come. Turning it off removes the login item (macOS:
      System Settings → General → Login Items).
- [ ] **Development storage.** With `BUDGETMINT_DATA_DIR` set, a dev build
      keeps its own sign-in and cache: the installed app's account is left
      alone.

## The platform (platform/os.rs)

- [ ] **Notifications permission.** Turning on Remind me on this device asks
      the first time (macOS), and the switch stays off if you refuse.
- [ ] **Google sign-in.** Continue with Google opens the system browser on
      Google's page; after choosing an account the browser says "You're
      signed in… go back to BudgetMint", and the app is signed in. Closing
      the browser tab instead leaves the app on the sign-in page after five
      minutes, with an error.
- [ ] **Window focus.** Open BudgetMint from the tray while another app is in
      front: the window comes forward and has the focus.

## Updates (platform/os.rs)

An update needs a release build and a feed newer than it. Try it on a build
with its own identifier, so the installed app and its data are left alone,
and against a local feed signed with a throwaway key (the real key never
leaves CI). Every file goes in one scratch folder, `$S`:

1. **A key:** `pnpm --filter @budgetmint/desktop exec tauri signer generate --ci -p "" -w $S/test.key`.
2. **Two configs**, `$S/config-old.json` and `$S/config-new.json`, alike but
   for `version` (`0.9.0` and `0.9.99`, say):

   ```json
   {
     "productName": "BudgetMint Update Test",
     "version": "0.9.0",
     "identifier": "com.budgetmint.updatetest",
     "plugins": {
       "updater": {
         "pubkey": "<the contents of $S/test.key.pub>",
         "endpoints": ["http://127.0.0.1:8765/latest.json"],
         "dangerousInsecureTransportProtocol": true
       }
     },
     "bundle": { "createUpdaterArtifacts": true, "targets": ["app"] }
   }
   ```

3. **Both builds**, from `apps/desktop` with
   `TAURI_SIGNING_PRIVATE_KEY=$S/test.key TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""`.
   Run `pnpm tauri build --config $S/config-old.json`, and copy
   `target/release/bundle/macos/BudgetMint Update Test.app` to `$S/install/`.
   Then run `pnpm tauri build --config $S/config-new.json`, and copy its
   `BudgetMint Update Test.app.tar.gz` and `.sig` to `$S/feed/`.
4. **The feed:** in `$S/feed/latest.json`, put `"version": "0.9.99"`, some
   `"notes"`, and
   `"platforms": { "darwin-aarch64": { "url": "http://127.0.0.1:8765/BudgetMint%20Update%20Test.app.tar.gz", "signature": "<the .sig's contents>" } }`.
   Serve it with `python3 -m http.server 8765 --bind 127.0.0.1 -d $S/feed`.
5. **Open** `$S/install/BudgetMint Update Test.app`. Afterwards, delete `$S`,
   `~/Library/Application Support/com.budgetmint.updatetest`,
   `~/Library/Logs/com.budgetmint.updatetest` and
   `~/Library/WebKit/com.budgetmint.updatetest`.

- [ ] **Automatic check.** About 10 seconds after launch, the dialog says
      BudgetMint 0.9.99 is available and that you have 0.9.0, with the
      notes. Later closes it.
- [ ] **Check now.** Settings → Updates → Check for updates opens the dialog
      again. Stop the feed and check again: the section says why it couldn't
      check. Turning off "Check for updates automatically" survives a
      relaunch.
- [ ] **Install.** Click Download and install. The progress shows MB
      downloaded, then "Installing…". The app restarts as 0.9.99 and is
      still signed in: Check for updates now says it's up to date.
- [ ] **Bad signature.** Change a character in the feed's `signature` and try
      again from the old build. The dialog says the update couldn't be
      installed, and the app stays as it was.
- [ ] **In the tray.** With the window closed to the tray when the launch
      check finds the update, an OS notification says it's available.
- [ ] **Development build.** In `pnpm tauri dev`, Download and install says a
      development build can't install updates.
- [ ] **A real release.** After a release, an install of the version before
      it finds and installs it from GitHub.

## The cloud

- [ ] **Offline.** With the network off, a launch shows the saved budget
      and "Offline"; a bill marked paid shows as waiting, and goes up when the
      network is back.
- [ ] **Two devices.** A change on one shows on the other within seconds.
      Delete BudgetMint data on one: the other starts over and says so.
- [ ] **TaskMint's forecast.** With TaskMint (4.2 or later) signed in to the
      same account and syncing, BudgetMint's Settings → TaskMint says the
      forecast is there, with TaskMint's version, and the next withdrawal
      matches TaskMint's Payouts (policy "as soon as open", no assumed
      earnings).

## Windows

- [ ] **No console window** opens with the app (`main.rs`).
- [ ] **The tray icon** is the app icon (macOS uses the one-color template),
      and its menu works as on macOS.
- [ ] **The installer** updates in passive mode: a progress window, no
      questions, then BudgetMint starts again.
