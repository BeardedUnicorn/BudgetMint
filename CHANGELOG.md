# Changelog

What changed in each BudgetMint release, newest first. Versions follow
[semantic versioning](https://semver.org): a major release can break what
older desktops or data expect, a minor one adds features, and a patch fixes
things.

`pnpm release` writes each section from the change notes in `changes/`
(see [changes/README.md](changes/README.md)).

## 2.4.0 – 2026-11-13

### Added

- About BudgetMint (in the BudgetMint menu, the tray, Settings → About and the account menu) shows the version, whether it's the newest (with Check for Updates on the desktop), what's new in it, and links to the release notes, reporting a problem, the privacy policy, the terms and the source. Copy version info puts the version and system on the clipboard, for a bug report.
- More than one bank account. Add savings or a second checking account in Settings → Bank accounts, each with its own balance and low mark. Bills, income and one-offs say which account they're paid from or into, and each account gets its own forecast: low and below-zero days, safe to spend and the low-balance reminder are per account, and the total is the accounts added up.
- The Overview shows each account at a glance and can be of all accounts or one, as can the Forecast. Bills and Income show each one's account and can be narrowed to one, and the sidebar's balance is all accounts together, with each a tap away.
- Updating a balance, and importing a bank statement, are for one account at a time: the others stay as they are. An account with no balance yet, or one older than 45 days, is left out of the total until it's updated, and its card says so.
- With one account nothing changes: no account is asked for anywhere, and nothing new is saved.
- An older BudgetMint (the Android app doesn't update itself: install the new one) sees only the main account. What's in other accounts, and money moved between accounts, isn't there, so it forecasts the main account without any transfers into or out of it. It can still update the main balance and its own bills, and says some of the budget is from a newer BudgetMint.
- On macOS, the menu bar has File (New Bill ⌘N, New Income ⇧⌘N, Update Balance… ⌘B, Import Bank Statement…, Download Backup… and Download Spreadsheet…), Go (each page, ⌘1 to ⌘7), View (Show or Hide Sidebar ⌃⌘S) and Help (Keyboard Shortcuts, Release Notes, Report a Problem…, Open Logs Folder, Privacy Policy and Terms of Use) menus, and Sign Out… in the BudgetMint menu. The budget's items are greyed out until you've signed in.
- ⇧⌘N (Ctrl+Shift+N) adds income and ⌘B (Ctrl+B) updates your balance, from any page, on the desktop.
- The tray's menu has About BudgetMint, and Sign Out… while you're signed in.
- Money moved between your bank accounts. With more than one account, Bills has "Money moved between accounts": schedule a transfer (to savings each month, to pay off a card) with From and To, and each account's forecast counts it, out of the one and into the other. A one-off move is recorded from the Overview's Add, or as "I moved" when recording a one-off.
- A transfer is marked moved the way a bill is marked paid, can be skipped, moved to another day or reminded of, and is never counted as a bill due, as income, or in Reports. Marked on a balance's own day, it can move both accounts' balances with it. One that's past its day and not marked yet still counts in both accounts, so what they hold together doesn't change.
- A balance update and a bank statement ask about a transfer in the account they're for: coming in to the one, going out of the other.
- An older BudgetMint (the Android app doesn't update itself: install the new one) sees only the main account and none of the transfers, so its forecast of the main account is off by whatever is moved into or out of it.

### Changed

- Cancel on a form you've changed asks before throwing the change away, as Escape and Back do. Cancel and Save stay in view however long the form is.
- Bills and Income have Mark paid (or Mark received) on each row, for the next one still open.
- The Forecast's "Day by day" counts the everyday spending of the days in between ("Everyday spending, 4 days"), so each day's lines add up to its balance.
- Savings lists archived goals, to bring one back from there.
- Wording: "1 transaction" and "1 line" on a bank statement, income is "expected" on a day rather than "due", "Rent brought back", and the Forecast says how long a TaskMint withdrawal takes the way Settings does.
- The Reports chart's axis is in your currency, and a TaskMint sign-out that fails says so.
- Who's signed in shows at the foot of the sidebar (and the phone's menu), with a menu to the account's settings, About and Sign out….
- Signing out asks first, and erases this device's copy of your budget, which stays in your account for the next sign-in. Deleting the account erases it too.
- The BudgetMint name at the top of the sidebar goes to the Overview.

### Fixed

- An amount typed with a decimal comma is read as it's meant everywhere: "135,50" in a bill is $135.50, as it already was in the balance, instead of $13,550.00. A comma before three digits still groups thousands ("1,820").
- An amount field writes the amount out in full when you leave it ("13,550.00"), so a slip shows before it's saved.
- The amounts in Settings say Saved when they save, and say so when what was typed isn't an amount instead of quietly keeping the old one.
- Going back to the pay step while setting up no longer adds your pay a second time: it's there as you saved it, and Next changes that one.
- Setting up, each common bill starts due on the 1st instead of today's day of the month, ticking a bill no longer moves the ones below it, and a payday or bill on or before the balance's day says it's taken as already in the balance.
- The first step says which currency amounts are in, and lets you change it there.
- The notice that the browser hasn't allowed notifications shows once instead of at every launch. Settings → Reminders keeps a line with the Allow button.
- On a phone, the bottom bar's five buttons fit the screen: Overview is no longer cut off at the left edge.
- The phone calendar keeps a day shown under the month when you change month (the 1st, or today in this month).
- A payment's date and amount sit one under the other on a phone, instead of squeezed side by side.
- The Overview's list marks a day that ends low or below zero with a sign as well as a colour.
- A bill due on the same day as your balance, and not marked paid, is now counted as still owed, and the next balance update asks about it. Before, the forecast left it out for good, so it showed money that was about to go.
- What your balance already counts on its own day (a bill on autopay, or one you marked paid that day) says "In your balance already", so the day's lines add up.
- Moving a bill's day after paying it no longer asks for the same month twice: paid on the 12th and moved to the 20th, this month's 20th is skipped, with a note saying why.
- The Forecast says how much income is due but not marked received, since that isn't counted until it is.
- Archiving a bill that's still overdue asks first, since the forecast lets the overdue amount go.
- Back closes About, Sign out and the keyboard shortcuts instead of changing the page under them.
- Forecast's "Day by day" counts the days of everyday spending rightly when your balance is from today (it said one too many), and lists the last day too, so it ends on the balance the heading gives.
- The calendar marks the days money moves between your accounts, with what's moved.
- With more than one bank account, importing a statement asks whose it is first. Before, it was taken as the main account's, and a savings statement could set the main account's balance.
- Bills lists a transfer with where it goes, not only where it leaves. On a phone, each bill's next date is under its name, where the column was off the screen's edge.
- A bill or transfer due today is listed with today, not under "Overdue and late" as well. On a phone, Reports keeps the month and its arrows on one line. A statement says "1 that isn't a bill or income".
- The Forecast no longer calls a bill or transfer due today "overdue": it is still counted today.

## 2.3.2 – 2026-11-12

### Fixed

- On Android, Back closes a form once its keyboard is down. Before, a field that kept the focus after the keyboard closed swallowed every Back.
- Back on a form with changes asks each time whether to discard them. Before, after you kept editing once, the next Back could skip the question and leave the app (or, in a browser, go further back than the page before), losing what you'd typed.

## 2.3.1 – 2026-11-12

### Fixed

- Marking a bill paid, or recording a one-off, on the same day as your balance now asks whether the balance has it already, and takes it off (or adds it) unless you say it does. Before, the balance stayed as it was and the forecast left the payment out, so it showed money that was gone.
- Signing out of TaskMint in Settings hides TaskMint again, as it should.
- On a phone, messages at the bottom no longer cover the bottom bar, the calendar marks the day you picked, and each row's details button sits beside its amount.
- Each page opens at its top, and an account you've just set up opens on the Overview.
- "Ends after" and "First due" say the year when it isn't this one, and the money set aside is called that wherever it's counted, goals included.

## 2.3.0 – 2026-11-12

### Added

- A savings goal, or a bill money is set aside for, can start from what's set aside already: say how much in its form, and the rest is spread over the months left. Saying it again later starts over from the new amount.
- A BudgetMint older than this one shows such a goal as it last saw it, and can't change it, until it's updated: everything else stays as it was there.

## 2.2.0 – 2026-11-12

### Added

- On a phone, a bar along the bottom opens the Overview, Bills, Calendar and Forecast in one tap, and More the rest. The top bar says when changes are still being saved, or BudgetMint is offline.
- Back (the browser's button, or Android's back gesture) closes a dialog or the sidebar first, asking before it throws a change away, then returns to the page before.
- A phone shows each page's line under its title too: when the balance was set, what bills and income come to a month.
- Record a one-off in a moment: Overview → Add → A one-off spend or income. Say what was spent or came in, how much and when (today unless you say otherwise). It's paid (or received) once its day has come, and still to come before then.
- The Overview's Add adds a bill, income or a one-off, and its first steps offer income as well as a bill.
- A one-off that's done, and a bill that has ended, move to a Finished part of the Bills and Income lists, a click away.
- Reports chart the six months' bills paid against the money that came in, and download a month's bills and income as a spreadsheet.
- Reports' "Left over" says it's before everyday spending, and about how much that comes to for the month.

### Changed

- Mark paid on a bill whose amount varies (or Mark received on such income) asks what it came to, instead of recording the estimate. A payment marked in its own dialog starts on today's date, as Mark paid does.
- The Overview asks what autopay bills whose amount varies came to once they're due, so the next ones' estimate learns from what was really paid.
- Updating the balance starts empty, showing the last one, and nothing is taken as paid until you tick it (or Tick all). Each one ticked takes what it really came to, which is what a bill whose amount varies learns from.
- A bank statement can be imported from Bills and from the Overview's Add, as well as Settings. What nothing matched is listed: record it as a one-off, or match it to a bill or income by hand.
- A statement matches a bill whose amount varies by its name even when the amount is well off what was expected.
- How often a bill or income repeats is chosen as you'd say it: every week, every 2 weeks, twice a month, every month, every 3 or 6 months, every year, or something else (every so many days, weeks, months or years, or a weekday of the month). New income starts at every 2 weeks.
- A monthly bill's day follows the date it starts on until you choose one, and the form says when it's first due.
- A bill can end after a number of payments (a loan's last 14), as well as on a date. Counting starts from the next one due.
- What's wrong with a bill is said under the field it's about, not above the form.
- A one-off bill doesn't offer to move off a weekend or to vary, and something saved up for doesn't offer autopay.
- A bill or income can be deleted without archiving it first.
- Categories that differ only in capital letters ("Utilities", "utilities") are one: a new bill takes the spelling already in use, and lists, filters and reports put them together.
- Getting started asks for your pay, a week's everyday spending and the bills most people have (rent, phone, internet, electric, car payment and insurance, subscriptions), each a step you can skip, so "Safe to spend" means something from the first day.
- The Overview says when everyday spending isn't counted yet, with a way to set it.
- A browser asks to allow notifications once there's a bill with a reminder, not before.
- On a phone, the Overview puts what's due before its summary cards, and the Calendar shows the day you tap under the month instead of over it, with low and below-zero days marked beside their date.
- On a phone, the Forecast lists each day with its money and the balance it leaves, instead of a table wider than the screen.
- Bills and income line up in the Overview's and Calendar's lists, their chip under the name, and a day's balance that's low is marked as one, not only coloured.
- A savings goal can be archived or deleted from its card on the Savings page.
- Turning off "Set money aside" on a bill says first that what's set aside for it is let go.
- Without TaskMint, BudgetMint is a plain bill tracker: TaskMint's withdrawals, its card, its calendar and report columns, its onboarding step and its settings show once a TaskMint account is signed in alongside. Until then, Settings → TaskMint offers to connect it. Signing out of TaskMint there hides it again; a TaskMint sign-in that lapses keeps it, to sign in again.
- The Overview no longer repeats the lowest balance ahead in a card of its own: the balance panel says it.
- One word for each thing throughout: the Overview's "Overdue and late" (bills overdue, income late), days marked "Low" or "Below zero", "set money aside" for savings, and "bank account" where it's the bank's.

### Fixed

- Escape no longer throws away a bill, a payment or a balance you've started changing: it asks first. A bank statement asks too, once there's something in it to save.
- A bill that has ended no longer counts in the Bills list's "A month" column or its monthly total.
- Forecast's Assumptions opens Settings → Forecast, where the everyday spending, how far ahead it looks and the low mark are.
- Income that comes in on its own says "Automatic", not "Autopay".
- Making an account, or resetting a password, says so in the page's title.
- Bills sorted by amount follow the estimate shown for one whose amount varies.
- The calendar's legend shows the dots a narrow calendar uses, and the forecast's chart names the low mark's line.
- Bills says "No category", as Reports does.

## 2.1.0 – 2026-11-11

### Added

- BudgetMint for Android: each release has `BudgetMint-X.Y.Z-android-arm64.apk` for arm64 phones. Open it on the phone to install it (allowing the browser or Files to install apps), and sign in as on the desktop, with your email and password or Google's account sheet. Reminders come with the app closed. It doesn't update itself: install the next release's APK over it, which keeps you signed in.
- On Android, Settings → Your data saves the backup and the spreadsheet: Download backup and Download spreadsheet open Android's file picker, to save the file where you choose (Downloads, for one).
- The web app can be installed from the browser (Install in Chrome and Edge, Add to Home Screen on iOS and Android), with BudgetMint's icon, and once it has been opened online it opens without a connection too.
- The web app shows BudgetMint's icon while it loads, instead of a blank page.
- A privacy policy and terms of use, at budgetmint.web.app/privacy and budgetmint.web.app/terms: what BudgetMint keeps (your budget, in Firebase, and usage statistics you can turn off; no ads) and how to delete it.
- Each release lists the SHA-256 checksum of every download in its SHA256SUMS file, to check a download against.
- The web and Android apps share which pages you open (Firebase Analytics), so we can see what's used; your bills, amounts and balances never go with it, and nothing of it is used for ads. Settings → Privacy → Share usage statistics turns it off on that device, and the privacy page says what's sent. The desktop app sends nothing.

## 2.0.2 – 2026-11-11

### Fixed

- After you sign in with Google in the browser, BudgetMint comes back to the front (your browser asks first), and the browser's page now has BudgetMint's look instead of a plain white page.

## 2.0.1 – 2026-11-11

No user-facing changes.

## 2.0.0 – 2026-11-11

### Changed

- BudgetMint has its own accounts now, apart from TaskMint's, and your budget moves with yours. Signing in with the same email and password as TaskMint (or the same Google account) still brings TaskMint's withdrawals. When they differ, sign in to TaskMint in Settings → TaskMint.
- Deleting your BudgetMint account no longer sends you to TaskMint, and leaves your TaskMint account as it is.
- Update BudgetMint everywhere you use it: older versions can't reach your budget once it has moved.

### Fixed

- The dollar sign in the BudgetMint leaf now sits in the middle of the leaf, as TaskMint's check does, instead of low and to the left, and the leaf's vein matches TaskMint's.

## 1.5.0 – 2026-11-11

### Added

- Updating your balance says what BudgetMint expected it to be by then, and asks about the bills and income due since your last update: the ones that haven't come out (or in) yet are left to come the day after, and the rest are marked paid. One Undo takes it all back.
- Settings → Your data imports a bank statement, as the CSV or OFX file your bank exports: BudgetMint matches it to the bills and income still open and marks the ones you tick paid, on the day and for the amount the bank shows, and can set your balance from the statement's. It's read on this device; only what you mark is saved. When it can't tell a CSV's columns apart, it asks which is which.
- Everyday spending (Settings → Forecast): a week's food, fuel and the rest besides your bills, which the forecast takes out a day's share at a time. After a few balance updates, BudgetMint says what you really spend a week, to use instead.
- A bill or income can come twice a month (the 1st and the 15th, the 15th and the last day) or on a weekday of the month (the second Friday, the last Monday), and a date that falls on a weekend can move to the Friday before or the Monday after, as banks move paydays.
- Reports: a month looked back on, with the bills paid against what was expected and by category, the income and TaskMint's withdrawals received, what's left over, the bills paid late, the spending besides the bills by your balance updates, and the six months up to it side by side.
- The overview says what's safe to spend today: what you could spend and still keep the balance above your low mark (or zero) all the way to the forecast's end, after everyday spending and what's set aside for bills.
- Savings: money set aside a month at a time for a yearly or monthly bill ("Set money aside for it each month" in its form), or for a goal of your own, a holiday or a laptop by a date. The Savings page shows how much is set aside for each and the next part; what's set aside isn't counted as safe to spend, and the forecast's chart draws the balance without it.
- When your balance would go below zero (or your low mark), the overview says what more TaskMint work would cover it: how much, the last day to earn it, and when it would be withdrawn and in the bank. Or, when no work now would arrive in time, says so.
- A bill whose amount varies (power, water) can be expected at the average of the last three paid: the ones to come show it with a ~, and the lists say what it's from.

### Changed

- What this version saves can't be changed from BudgetMint 1.4 or older on another device, which would drop what's new: that device says to update first. Backups from this version restore in this version or later.

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
