# ADR 0003: BudgetMint in its own Firebase project

- **Status:** accepted (2026-11-11)
- **Supersedes:** [ADR 0002](0002-taskmint-forecast-and-shared-project.md)'s
  decisions 1, 3 (for BudgetMint's rules) and 4, and its account-deletion
  consequence
- **Scope:** BudgetMint's Firebase project, how it signs in to TaskMint's for
  the forecast, and who owns what

## Context

BudgetMint ran in TaskMint's project `taskmint-f9a05`, so TaskMint's rules,
release and Delete account all had to know about BudgetMint's data. It
should be its own project. It still needs TaskMint's forecast, which stays
in TaskMint's project. Firestore rules there only trust sign-ins to that
project.

## Decisions

1. **BudgetMint's own project, `budgetmint`**: its accounts, its Firestore
   (nam5, as TaskMint's), its Hosting site `budgetmint`, and its rules
   (`rules/firestore.rules`, unchanged from the `budgetmint/` block they
   were in TaskMint's). BudgetMint's release deploys the rules, then the
   site.
2. **Signed in to TaskMint alongside, for the forecast only.** The client
   runs a second Firebase app on TaskMint's project:
   - Signing in to BudgetMint with an email and password tries the same on
     TaskMint.
   - Signing in with Google uses the same Google credential on TaskMint.
   - When TaskMint has no such account (or another password), BudgetMint
     goes on without the forecast. Settings → TaskMint signs in to TaskMint
     alone.
   - The forecast is read at `users/{uid}/published/payoutForecast` with
     TaskMint's uid, which needn't be BudgetMint's.
3. **BudgetMint never makes a TaskMint account.** A Google sign-in to
   TaskMint that created one (`isNewUser`) deletes it again at once. Making a
   BudgetMint account only tries to sign in to TaskMint.
4. **BudgetMint writes nothing in TaskMint's project.** The emulator test
   loads TaskMint's pinned rules for TaskMint's project and checks that only
   the forecast it seeded is there afterwards.
5. **TaskMint still owns the forecast contract and its rules for `users/`.**
   `firebase/` keeps the pinned copy, now only for the tests.

## Consequences

- Each project's Google sign-in must accept the other's Google clients:
  - `budgetmint` safelists the "BudgetMint desktop" OAuth client, which is in
    TaskMint's Google Cloud project.
  - `taskmint-f9a05` safelists the `budgetmint` web client.
  - TaskMint's authorized domains include BudgetMint's Hosting domains, for
    Settings' Google sign-in to TaskMint on the web.
- Deleting a BudgetMint account is BudgetMint's: it deletes the data and the
  account, and only signs out of TaskMint.
- The accounts and data that were in `taskmint-f9a05` move once (the
  runbook's "Moving from TaskMint's project"). The Auth import keeps each
  uid and password. After that, TaskMint drops its `budgetmint/` rules and
  its Delete account's BudgetMint step.
- An installed BudgetMint from before this keeps using `taskmint-f9a05`
  until it updates, so the move is a major version.
