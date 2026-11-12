---
bump: patch
type: Fixed
---
- A bill due on the same day as your balance, and not marked paid, is now counted as still owed, and the next balance update asks about it. Before, the forecast left it out for good, so it showed money that was about to go.
- What your balance already counts on its own day (a bill on autopay, or one you marked paid that day) says "In your balance already", so the day's lines add up.
- Moving a bill's day after paying it no longer asks for the same month twice: paid on the 12th and moved to the 20th, this month's 20th is skipped, with a note saying why.
- The Forecast says how much income is due but not marked received, since that isn't counted until it is.
- Archiving a bill that's still overdue asks first, since the forecast lets the overdue amount go.
