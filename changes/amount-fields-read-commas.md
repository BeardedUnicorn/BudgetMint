---
bump: patch
type: Fixed
---
- An amount typed with a decimal comma is read as it's meant everywhere:
  "135,50" in a bill is $135.50, as it already was in the balance, instead
  of $13,550.00. A comma before three digits still groups
  thousands ("1,820").
- An amount field writes the amount out in full when you leave it
  ("13,550.00"), so a slip shows before it's saved.
- The amounts in Settings say Saved when they save, and say so when what
  was typed isn't an amount instead of quietly keeping the old one.
