---
bump: patch
type: Fixed
---
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
