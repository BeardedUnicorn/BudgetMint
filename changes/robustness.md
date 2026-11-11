---
bump: patch
type: Fixed
---
- Saving an edit to a bill that was deleted on another device meanwhile says it's gone, instead of bringing it back.
- If deleting your data is cut short (the connection drops, the app closes), what was left reads as deleted on every device and is deleted the next time BudgetMint opens.
- A large change made offline (more than 400 records) is kept whole until it can be sent, not just its first part.
- Clearer messages when the cloud's limit for the day is used up, a sign-in has run out, or the cloud is too slow to answer, and when your data can't be read rather than saved.
- The overview and the forecast say why TaskMint's withdrawals aren't there: still checking, an update needed, or a forecast that can't be read (not just "isn't connected"). The overview also warns when TaskMint's work logs haven't been imported for three days.
- Records that can't be read are counted in a notice instead of left out without a word.
- A date with a mistyped year (outside 1900–2199) is refused, and a TaskMint forecast with numbers TaskMint couldn't have written reads as unreadable, instead of stopping BudgetMint.
- If BudgetMint itself stops on a problem, the page says so and offers to reload, rather than failing at every click.
- The pages follow a change of time zone as soon as BudgetMint is back in front.
