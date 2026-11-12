---
bump: patch
type: Fixed
---
- On Android, Back closes a form once its keyboard is down. Before, a field that kept the focus after the keyboard closed swallowed every Back.
- Back on a form with changes asks each time whether to discard them. Before, after you kept editing once, the next Back could skip the question and leave the app (or, in a browser, go further back than the page before), losing what you'd typed.
