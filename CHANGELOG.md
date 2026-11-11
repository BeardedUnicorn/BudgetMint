# Changelog

What changed in each BudgetMint release, newest first. Versions follow
[semantic versioning](https://semver.org): a major release can break what
older desktops or data expect, a minor one adds features, and a patch fixes
things.

`pnpm release` writes each section from the change notes in `changes/`
(see [changes/README.md](changes/README.md)).

## 1.0.0 – 2026-11-10

### Added

- BudgetMint's first release: your bills and income, and your balance day by day, on the desktop (macOS and Windows) and the web, signed in with your TaskMint account (email or Google) so every device shares the same budget.
- Bills and income that repeat once, every few days, weeks, months or years, with autopay, categories, notes and reminders. Mark one paid or received, skip it, or change its amount, with Undo; change a schedule from a date on, and archive what's finished.
- The Overview shows today's balance, the lowest point ahead and the first day it goes short; the Calendar, each day's bills, income and closing balance; the Forecast, the balance line up to a year ahead.
- TaskMint's upcoming withdrawals count as income, under your withdrawal policy, minimum and bank delay, with earnings assumed further out if you like (marked as assumed).
- Reminders before a bill is due, when income should arrive, and when the balance would go short, at the hour you choose. The desktop shows them from the tray, shows the ones it missed while closed when it opens, and can open at login.
- Updates itself on the desktop from BudgetMint's GitHub releases, asking first.
