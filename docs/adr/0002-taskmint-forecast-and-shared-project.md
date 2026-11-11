# ADR 0002: TaskMint's forecast, in TaskMint's Firebase project

- **Status:** accepted (2026-11-10)
- **Scope:** how BudgetMint learns TaskMint's upcoming withdrawals, the
  Firebase project and rules they share, and who owns what

## Context

TaskMint computes upcoming releases and the next withdrawal live in its
client; nothing stored says what's coming. BudgetMint needs those amounts
and dates without porting TaskMint's payout rules, which change with
TaskMint.

## Decisions

1. **The same Firebase project and accounts** (`taskmint-f9a05`): one
   sign-in for both apps, and BudgetMint can read what TaskMint publishes
   for the same user.
2. **TaskMint publishes a forecast**, `users/{uid}/published/payoutForecast`
   ([contract](../taskmint/payout-forecast.md)): the withdrawable amount as
   a step curve over time, which doesn't depend on the clock, plus the
   withdrawal interval, the latest withdrawals and recent daily earnings.
   Only numbers: no task names or notes. BudgetMint projects a series of
   withdrawals from it, each taking W(t) − W(previous).
3. **TaskMint owns the rules and the contract.** Both apps' rules live in
   TaskMint's `firebase/firestore.rules`, deployed by TaskMint's release.
   BudgetMint keeps pinned copies (`firebase/UPSTREAM.json`, checked in
   `pnpm verify`) and deploys only its Hosting site. The rules check
   BudgetMint's documents by kind, id pattern, size and epoch, but keep
   their JSON opaque, so BudgetMint's model can change without a TaskMint
   release; only a new kind needs one.
4. **BudgetMint never writes under `users/`.** The rules can't stop it (same
   uid), so `scripts/test-emulator.sh` runs BudgetMint's real writes against
   the rules and checks that nothing outside `budgetmint/` exists afterwards.

## Consequences

- TaskMint must be released (with the publisher and the rules) before
  BudgetMint can read a forecast. Without one, BudgetMint is a plain bill
  tracker and says so.
- Changing the contract is a TaskMint change first, then
  `pnpm upstream:pull`; core's TaskMint fixtures check BudgetMint reproduces
  TaskMint's own numbers.
- Deleting the account is TaskMint's while TaskMint has data on it; TaskMint's
  Delete account removes BudgetMint's data first.
