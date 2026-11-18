---
bump: patch
type: Fixed
---
- A bank statement's money out is read as money out where it was taken for
  money in: files with "Debit Amount" and "Credit Amount" columns or a
  "Value Date", amounts written like "$-12.34", a column or an OFX type
  saying debit or credit, and so on. The statement shows it with a minus
  ("-$4.50"), money in with a plus, and how much went each way.
- Giving a statement's line a category no longer moves it: the list stays
  in the order it was read in, and a category is taken when you leave its
  field, not letter by letter.
- A statement's line matched to money moved between your accounts is kept
  as moved, not as spending or income.
