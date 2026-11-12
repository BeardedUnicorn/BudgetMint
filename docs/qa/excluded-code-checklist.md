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
| `apps/desktop/src-tauri/src/app.rs` | the Tauri builder: plugins, setup, the window and its saved place, the macOS menu bar, the menus' clicks, the reminders' thread, the run loop | [Startup and wiring](#startup-and-wiring-apprs), [The menus](#the-menus-apprs-platformosrs) |
| `apps/desktop/src-tauri/src/platform/os.rs` | `TauriPlatform`: events, notifications, the browser, the logs folder, the save dialog, the window and the Dock icon, the menus and the tray, opening at login, the updater | [The platform](#the-platform-platformosrs), [The menus](#the-menus-apprs-platformosrs), [Updates](#updates-platformosrs) |
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
      when signed in, and the tray icon appears with Open BudgetMint,
      Settings…, Check for Updates… and Quit BudgetMint.
- [ ] **Second launch.** Launching again while it runs brings the first
      window forward instead of opening another.
- [ ] **Close to the tray.** Closing the window (its close button, or ⌘W)
      hides it. On macOS its Dock icon goes too, leaving the menu-bar icon,
      and ⌘-Tab no longer lists BudgetMint. The tray's Open BudgetMint brings
      the window back, with the Dock icon and the menu bar. Quit BudgetMint
      quits.
- [ ] **Window size and position.** On a first launch (no
      `.window-state.json` in the app's config folder: on macOS
      `~/Library/Application Support/com.budgetmint.desktop`) the window is
      1280×860 and centered. Move and resize it, quit from the tray and
      launch again: it comes back where it was, at that size. Again after
      closing it to the tray first, and after an update's restart. Move it
      to a second display, quit, disconnect the display and launch: the
      window is on the remaining display.
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
      login, log out and in: BudgetMint runs in the tray without its window
      (and on macOS without a Dock icon), and reminders come. Open BudgetMint
      from the tray: the window is where it was last time. Turning it off
      removes the login item (macOS: System Settings → General → Login
      Items).
- [ ] **Development storage.** With `BUDGETMINT_DATA_DIR` set, a dev build
      keeps its own sign-in and cache: the installed app's account is left
      alone.

## The platform (platform/os.rs)

- [ ] **Notifications permission.** The desktop notification plugin
      (tauri-plugin-notification 2.8.1, `desktop.rs`) always reports the
      permission as granted, without asking, so turning on Remind me on this
      device turns it on at once, and the "turned off for BudgetMint" warning
      never shows on a desktop. Send a test reminder: the first one may bring
      macOS's own prompt. Refuse it (or turn BudgetMint off in System
      Settings → Notifications): the switch stays on, the test says "Sent. If
      nothing appeared, allow BudgetMint's notifications…", and nothing
      appears. Allowing them again in System Settings brings the next test
      through.
- [ ] **Google sign-in.** On macOS this needs a built app, since only a
      `.app` gets `budgetmint://` links: `pnpm tauri build --debug --bundles
      app`, then open `target/debug/bundle/macos/BudgetMint.app`. Continue
      with Google opens the system browser on Google's page. After choosing
      an account the browser shows BudgetMint's page: the wordmark over a
      card with a green check and "Google's part is done", in the system's
      light or dark colors. The browser asks to open BudgetMint; allowing it
      brings the window forward over the browser, signed in. Turning that
      down leaves the page, and its Open BudgetMint button asks again.
      Cancelling on Google's page shows "Signing in didn't finish" with a
      red mark, doesn't ask to open BudgetMint, and leaves the window where
      it was; Back to BudgetMint brings it forward. Closing the browser tab
      instead leaves the app on the sign-in page after five minutes, with an
      error. Settings → TaskMint's Google sign-in does the same.
- [ ] **BudgetMint links.** With the window hidden in the tray, `open
      budgetmint://` (on Windows, `start budgetmint://`) brings it forward.
      With BudgetMint quit, the same starts it.
- [ ] **Window focus.** Open BudgetMint from the tray while another app is in
      front: the window comes forward and has the focus. Again with the
      window minimized: it comes back unminimized.
- [ ] **Logs folder.** Settings → Troubleshooting → Open logs folder opens
      Finder (Explorer on Windows) on the log folder: on macOS
      `~/Library/Logs/com.budgetmint.desktop`, on Windows
      `%LOCALAPPDATA%\com.budgetmint.desktop\logs`. It holds `BudgetMint.log`.
- [ ] **Saving a backup.** Settings → Your data → Download backup opens
      the system's save dialog over the window (a sheet on macOS), named
      `budgetmint-<today>.json` and showing only BudgetMint backups. Save
      it, and open the file: it's the backup's JSON (`"format":
      "budgetmint-backup"`). Restore from a backup… takes it back.
- [ ] **Saving a spreadsheet, cancelling, overwriting.** Download
      spreadsheet suggests `budgetmint-<today>.csv`; it opens in a
      spreadsheet app with a row per bill and income. Cancel the dialog:
      nothing is saved and no error shows. Save over an existing file: the
      system asks to replace it, and the file is the new one.
- [ ] **The webview's errors in the log.** In a dev build, open the
      webview's inspector (right-click → Inspect Element), and in its
      console run `console.error('QA check')` and
      `Promise.reject('QA rejection')`. `BudgetMint.log` gets both, under
      `[webview]`: `QA check`, and `Unhandled rejection: QA rejection`.
- [ ] **Capabilities.** After a launch, a sign-in, an update check and a
      click on Settings → About → Source and releases (which opens GitHub in
      the browser), the log has no `not allowed` line: everything the
      webview calls is in `capabilities/default.json`.

## The menus (app.rs, platform/os.rs)

The macOS menu bar, and the tray's menu on both platforms. Windows has no
menu bar.

- [ ] **About BudgetMint** (macOS, the BudgetMint menu) shows the version
      and "Copyright © 2026 Mike Herold".
- [ ] **Settings…** (BudgetMint menu, or ⌘,) opens Settings, from any page.
      With a dialog open (Add a bill) neither does anything, as the
      shortcut doesn't. With the window closed to the tray, the menu-bar
      icon's Settings… brings the window forward on Settings (Windows: the
      tray icon's).
- [ ] **Check for Updates…** (BudgetMint menu, and the tray's) brings the
      window forward with a dialog: "Checking for updates…", then
      "BudgetMint is up to date" with the version, OK to close. With the
      network off it says "Couldn't check for updates" and why. Against a
      newer feed it opens the update dialog (see [Updates](#updates-platformosrs)).
- [ ] **Edit.** In a text field (a bill's name), ⌘C, ⌘X, ⌘V, ⌘A, ⌘Z and
      ⇧⌘Z work, and so do the same items in the Edit menu. Copy a bill's
      name from BudgetMint and paste it into another app, and the other way.
- [ ] **View and Window.** Toggle Full Screen fills the screen and back;
      Minimize, Zoom and Close Window act on the window, Close Window hiding
      it to the tray. Hide BudgetMint, Hide Others, Show All and Quit
      BudgetMint do as they say.

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
- [ ] **Check now.** Settings → Updates says "You have BudgetMint 0.9.0"
      and when it last checked. Check for updates opens the dialog again,
      and the time of the last check changes. Stop the feed and check again:
      the section says why it couldn't check. Turning off "Check for updates
      automatically" survives a relaunch.
- [ ] **Skip this version.** In the dialog, Skip this version closes it.
      Relaunch: no dialog and no notification about 0.9.99, and Settings →
      Updates → Check for updates says it's available and you chose to skip
      it, with Update… still there. The menu's Check for Updates… still
      offers it. Change the feed's `latest.json` to `"version": "0.9.100"`
      and relaunch: the automatic check asks again.
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

### On Windows

The same two builds and local feed, on Windows (PowerShell, `$S` a scratch
folder), as NSIS installers:

1. **The key** as on macOS, and the two configs with
   `"bundle": { "createUpdaterArtifacts": true, "targets": ["nsis"] }`.
2. **Both builds**, from `apps\desktop`, with
   `$env:TAURI_SIGNING_PRIVATE_KEY = "$S\test.key"` and
   `$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""`. Build the old one and run
   its `target\release\bundle\nsis\BudgetMint Update Test_0.9.0_x64-setup.exe`
   to install it. Build the new one, and copy its
   `BudgetMint Update Test_0.9.99_x64-setup.exe` and `.exe.sig` to `$S\feed\`.
3. **The feed:** `latest.json` as on macOS, with
   `"platforms": { "windows-x86_64": { "url": "http://127.0.0.1:8765/BudgetMint%20Update%20Test_0.9.99_x64-setup.exe", "signature": "<the .sig's contents>" } }`.
   Serve it with `py -m http.server 8765 --bind 127.0.0.1 -d $S\feed`.
4. **Afterwards**, uninstall BudgetMint Update Test (Settings → Apps), and
   delete `$S`, `%APPDATA%\com.budgetmint.updatetest` and
   `%LOCALAPPDATA%\com.budgetmint.updatetest`.

- [ ] **Automatic check and Skip this version**, as on macOS.
- [ ] **Install.** Download and install shows the download, then the
      installer runs in passive mode: a progress window, no questions. It
      starts BudgetMint Update Test again as 0.9.99 (Settings → Updates says
      so), still signed in, and Settings → Apps lists one copy, 0.9.99.
- [ ] **Bad signature.** As on macOS: the dialog says the update couldn't be
      installed, and nothing is installed.

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

## Android

On the emulator or a phone with Google Play services, with the release APK
(`pnpm release --rebuild --target android-arm64`, the README's "Android
signing") unless a step says otherwise:

- [ ] **Installs over the last one:** the APK installs over the previous
      release's and keeps the sign-in.
- [ ] **Launch screen:** a cold start (swipe BudgetMint out of Recents, then
      open it from the launcher) shows the leaf on teal, with the BudgetMint
      wordmark at the bottom on Android 12 and later, until the app fades in.
      No black or white screen between them.
- [ ] **Status bar** follows the app's theme (Settings → Appearance), light
      and dark, once the launch screen has gone (its icons are light on the
      teal while it shows).
- [ ] **Google sign-in:** Continue with Google shows Android's account sheet
      (the form says "Choose your Google account.") and signs in to
      BudgetMint, and to TaskMint when that Google account has one (Settings
      → TaskMint). A debug APK works too: both keys are registered.
- [ ] **Analytics:** with Settings → Privacy → Share usage statistics on,
      each page opened reaches Firebase (Analytics → DebugView, after
      `adb shell setprop debug.firebase.analytics.app com.budgetmint.android`)
      with only the page's name; off, nothing more goes.
- [ ] **No advertising ID:** `aapt2 dump permissions` on the APK lists no
      `AD_ID` or `ACCESS_ADSERVICES_*` permission.
- [ ] **Reminders:** Settings → Reminders asks for notifications on Android
      13 and later; a bill's reminder comes at its hour with the app swiped
      away, in Doze (`adb shell dumpsys deviceidle force-idle`) and after a
      reboot.
- [ ] **Your data:** it says the app can't save files yet (the web app
      can), and importing a bank statement opens Android's file picker.

## Windows

- [ ] **No console window** opens with the app (`main.rs`).
- [ ] **The tray icon** is the app icon (macOS uses the one-color template),
      and its menu works as on macOS.
- [ ] **A click on the tray icon** opens the window, from hidden or from
      behind another app; a right click opens the menu. A double click opens
      the window too.
- [ ] **No menu bar** in the window.
- [ ] **The installer and the app's details:** Settings → Apps lists
      BudgetMint by Mike Herold, and the installed `BudgetMint.exe`'s
      Properties → Details show "Copyright © 2026 Mike Herold".
- [ ] **The updater:** [Updates, on Windows](#on-windows).

## Bundle metadata (tauri.conf.json)

- [ ] **macOS:** Finder's Get Info on BudgetMint.app shows "Copyright © 2026
      Mike Herold", and its `Contents/Info.plist` has
      `LSApplicationCategoryType` `public.app-category.finance`.
