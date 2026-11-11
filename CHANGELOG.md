# Changelog

What changed in each BudgetMint release, newest first. Versions follow
[semantic versioning](https://semver.org): a major release can break what
older desktops or data expect, a minor one adds features, and a patch fixes
things.

`pnpm release` writes each section from the change notes in `changes/`
(see [changes/README.md](changes/README.md)).

## 1.1.0 – 2026-11-11

### Added

- On macOS, BudgetMint has its own menu bar: About BudgetMint, Settings… (⌘,), Check for Updates…, and the Edit, View and Window menus.
- The tray's menu has Settings… and Check for Updates… too. Check for Updates… says what it found, even when BudgetMint is up to date.
- The window opens where you left it, at the size you left it. The first time, it opens in the middle of the screen.
- Settings → Updates shows the version you have and when BudgetMint last checked for a new one.
- The update dialog has Skip this version: the daily check stops asking about that version, until a newer one is out.
- Settings → Troubleshooting opens the folder with BudgetMint's log, to attach to a bug report. The log now has the window's errors too.

### Changed

- On macOS, closing the window to the menu bar takes its Dock icon away too, and opening it from the menu bar brings both back.
- On Windows, a single click on the tray icon opens the window. A right click opens its menu.
- After you sign in with Google in the browser, BudgetMint's window comes back in front.

### Fixed

- In light mode, the outline around the focused day on the Calendar is dark enough to see.
- In Safari and the Mac app, a field's border no longer runs through its label while it's selected, or leaves a gap above an empty field you've left.

## 1.0.1 – 2026-11-11

### Fixed

- In dark mode, the text on colored chips and buttons (Paid, Overdue, Delete) and the teal withdrawal amounts are easier to read.
- In light mode, the outline around the focused button or field is dark enough to see.
- A low or below-zero balance is marked with an icon in the calendar and the forecast, an overdue bill's next date says "Overdue", and the calendar's dots on a phone differ in shape, so color isn't the only cue.
- Large amounts wrap inside the overview's cards on a phone, and a long bill name wraps instead of widening the table.
- Undo no longer takes back a later change along with the one it undoes: if the item was changed again since, it says so instead.
- The calendar and a bill's history no longer mark as overdue the bills your balance already covers.
- On a day the clocks change, the forecast no longer lists a TaskMint withdrawal that arrives the day after.
- TaskMint's open timers and average earnings are counted in TaskMint's time zone when this device is in another.
- A bill that repeats every day keeps all its dates in a long forecast from an old balance.
- The low balance mark and the other amounts in Settings follow a change made on another device, and only save what you type.
- A click outside a bill's form no longer throws away what you typed (Escape and Cancel still close it).
- A bill's amount for one time can go back to the usual amount.
- A reminder with several days set on another device keeps them when the bill is edited here.
- Reminders that are on but not allowed now ask: the phone's system at launch, and a browser when you click Allow.
- In a browser, reminders stay on time after the computer sleeps, and Settings no longer mentions a tray or keyboard shortcuts the browser keeps for itself.
- A Google sign-in left unfinished in the browser can be cancelled, and the browser's page no longer says you're signed in when you aren't.
- Onboarding shows which account is signed in, with a way to sign out.
- On Android, reminders for bills paid or deleted while the app was closed are cleared when it opens.
- On Linux, Quit in the tray menu works.
- The desktop app still checks for updates when it can't start.
- A form says what's wrong under the field it's about, and puts the cursor there.
- Settings has "Send a test reminder", to check that the system lets BudgetMint's notifications through.
- Screen readers read the messages that pop up in the corner, and the forecast's chart says in words where the balance starts, its lowest point and where it ends.
- On a phone, "Every how many months" has room in a bill's form.
- A bill paid well before it's due (a yearly one paid months early, say) now comes off the forecast on the day it was paid, so the overview, the forecast and the calendar agree.
- No more "balance goes below zero" reminders before a balance has been set.
- Marking a bill paid from a list keeps the date it was moved to and its amount for that time.
- Editing a bill's name and its amount together saves both or neither, with Undo for the whole edit.
- A bill deleted on another device closes its open history instead of blanking the window, and a page that fails now says so with a way to try again.
- Delete account checks first that you signed in recently and are online, so it can no longer delete your data and then fail to delete the account.
- Signing out clears the account's reminders and its balance in the tray.
- An amount typed with a decimal comma ("1234,50") is read as $1,234.50, not $123,450.
- A bill changed by a newer BudgetMint on another device can't be overwritten from an older one: it says to update instead.
- The "Source and releases" link in Settings opens in the browser on the desktop app.

## 1.0.0 – 2026-11-10

### Added

- BudgetMint's first release: your bills and income, and your balance day by day, on the desktop (macOS and Windows) and the web, signed in with your TaskMint account (email or Google) so every device shares the same budget.
- Bills and income that repeat once, every few days, weeks, months or years, with autopay, categories, notes and reminders. Mark one paid or received, skip it, or change its amount, with Undo; change a schedule from a date on, and archive what's finished.
- The Overview shows today's balance, the lowest point ahead and the first day it goes short; the Calendar, each day's bills, income and closing balance; the Forecast, the balance line up to a year ahead.
- TaskMint's upcoming withdrawals count as income, under your withdrawal policy, minimum and bank delay, with earnings assumed further out if you like (marked as assumed).
- Reminders before a bill is due, when income should arrive, and when the balance would go short, at the hour you choose. The desktop shows them from the tray, shows the ones it missed while closed when it opens, and can open at login.
- Updates itself on the desktop from BudgetMint's GitHub releases, asking first.
