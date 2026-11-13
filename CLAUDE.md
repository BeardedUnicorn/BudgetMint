# Working in BudgetMint

- **Two Firebase projects** ([ADR 0003](docs/adr/0003-own-firebase-project.md)).
  BudgetMint's own, `budgetmint`, holds its accounts and data under its rules
  (`rules/firestore.rules`, deployed by its release). TaskMint's,
  `taskmint-f9a05`, is signed in to alongside for the forecast only.
- **Dev builds use the dev pair** ([ADR 0005](docs/adr/0005-dev-environment.md)):
  `budgetmint-dev` and TaskMint's `taskmint-dev`. `BUDGETMINT_ENV` is
  `production` only in a release (`scripts/release.mjs`, the release
  workflow); unset is dev. `.firebaserc`'s default is `budgetmint-dev`, so
  production commands name `--project budgetmint`. `pnpm deploy:dev` deploys
  to dev.
- **TaskMint owns its parts.** Its Firestore rules and the payout forecast
  contract live in TaskMint (`~/code/taskmint-app`). `firebase/`,
  `docs/taskmint/` and core's TaskMint fixtures are pinned copies
  (`firebase/UPSTREAM.json`): never edit them here. Change them in TaskMint,
  then `pnpm upstream:pull`.
- **Write nothing in TaskMint's project** (`taskmint-dev` either). BudgetMint
  writes only `budgetmint/{uid}` and its `data/` documents, in its own
  project, and only reads TaskMint's `users/{uid}/published/payoutForecast`.
  Never make a TaskMint account. `scripts/test-emulator.sh` checks this against both
  projects' rules.
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
