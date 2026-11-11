# Working in BudgetMint

- **TaskMint owns the shared parts.** The Firestore rules and the payout
  forecast contract live in TaskMint (`~/code/taskmint-app`). `firebase/`,
  `docs/taskmint/` and core's TaskMint fixtures are pinned copies
  (`firebase/UPSTREAM.json`): never edit them here. Change them in TaskMint,
  then `pnpm upstream:pull`.
- **Never write under `users/`.** That's TaskMint's data. BudgetMint writes
  only `budgetmint/{uid}` and its `data/` documents, and reads TaskMint's
  `users/{uid}/published/payoutForecast`. `scripts/test-emulator.sh` checks
  this against the rules.
- **Rules live in core.** Every budget rule (recurrence, settlement, the
  withdrawal series, reminders) belongs in `crates/budgetmint-core`, which
  stays pure: no I/O, clock or randomness (`clippy.toml`). The client asks
  core; it doesn't compute. After changing core's wire types, regenerate the
  contracts (`scripts/check-contracts.sh`) and commit them.
- **Change notes.** A change a user would notice adds a note in `changes/`
  (format in [changes/README.md](changes/README.md)), in the same branch.
  Internal work (tests, refactors, tooling) needs none.
- **Versions and the changelog** are written by `pnpm release` only. Don't
  edit a manifest's version or CHANGELOG.md's released sections by hand.
- **Releases** are cut in the main checkout, on `main`, never in a worktree.
  `pnpm release` commits and tags locally; push or `--publish` only when
  asked (the repository is public).
- **Copied UI.** Code taken from TaskMint keeps its first-line
  `Copied from` / `Adapted from TaskMint <path> @ <sha>` note, so the two
  can be compared later.
- **Formatting.** Biome formats and lints the TypeScript and JavaScript:
  run `pnpm lint:fix` before committing, since the pre-commit hook rejects
  unformatted staged files. Rust: `cargo fmt --all`.
- **Gates.** `pnpm verify` (scripts/verify.sh) runs every check CI does,
  with 100% coverage everywhere; exclusions go only in
  `coverage-policy.json`. Run it before merging.
