# Changelog

What changed in each BudgetMint release, newest first. Versions follow
[semantic versioning](https://semver.org): a major release can break what
older desktops or data expect, a minor one adds features, and a patch fixes
things.

`pnpm release` writes each section from the change notes in `changes/`
(see [changes/README.md](changes/README.md)).

## 1.4.0 – 2026-11-11

### Added

- The desktop app saves backups and spreadsheets (Settings → Your data), in the system's save dialog.

## 1.3.0 – 2026-11-11

### Added

- A bill or income can end on a date, shown in its list ("until Jun 30, 2027").
- Bills and Income can be searched by name or category, narrowed to one category, and put in order by name, amount or what each comes to a month. Each category's monthly total shows under the list, and an item's note shows under its name and at the top of its history.
- Categories already in use are offered as you type one.
- Settings → Your data downloads a backup of your budget and a spreadsheet of a year's bills and income (in a browser for now), and restores a backup, with Undo.
- Up to three reminders before each bill.
- ⌘N (Ctrl+N) adds a bill, or income on its page, and ⌘/ lists every shortcut, on the desktop.
- Amounts can be written in another currency, and the calendar's weeks can start on Monday (Settings → Appearance).
- Creating an account asks for the password twice and can show it; onboarding starts on Enter and offers the same arrival times as Settings; amount fields take up to the largest amount BudgetMint does.
- On a phone, each bill's actions are in a menu by its name.

### Fixed

- Saving an edit to a bill that was deleted on another device meanwhile says it's gone, instead of bringing it back.
- If deleting your data is cut short (the connection drops, the app closes), what was left reads as deleted on every device and is deleted the next time BudgetMint opens.
- A large change made offline (more than 400 records) is kept whole until it can be sent, not just its first part.
- Clearer messages when the cloud's limit for the day is used up, a sign-in has run out, or the cloud is too slow to answer, and when your data can't be read rather than saved.
- The overview and the forecast say why TaskMint's withdrawals aren't there: still checking, an update needed, or a forecast that can't be read (not just "isn't connected"). The overview also warns when TaskMint's work logs haven't been imported for three days.
- Records that can't be read are counted in a notice instead of left out without a word.
- A date with a mistyped year (outside 1900–2199) is refused, and a TaskMint forecast with numbers TaskMint couldn't have written reads as unreadable, instead of stopping BudgetMint.
- If BudgetMint itself stops on a problem, the page says so and offers to reload, rather than failing at every click.
- The pages follow a change of time zone as soon as BudgetMint is back in front.

## 1.2.0 – 2026-11-11

### Added

- The calendar shows what you earned in TaskMint on each day you worked, past days included, until a withdrawal takes it, and when that withdrawal reaches the bank. It doesn't change the day's balance: the money counts when it arrives. It needs TaskMint 4.2.3 or later.

### Fixed

- TaskMint withdrawals that reached the bank on or before your balance's date, or in an earlier month, show on the calendar and count in that month's TaskMint total.

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
