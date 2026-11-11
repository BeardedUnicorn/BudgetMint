# Runbook: BudgetMint on Firebase

How to deploy, watch, recover and lock down BudgetMint's data and web app, on
TaskMint's Firebase project `taskmint-f9a05`. The design is
[ADR 0001](adr/0001-cloud-first-core-in-wasm.md) and
[ADR 0002](adr/0002-taskmint-forecast-and-shared-project.md). TaskMint's own
runbook covers the project as a whole (its quotas, accounts and sign-up);
this one covers what's BudgetMint's. Commands run from the repository root.
`pnpm firebase` is firebase-tools at the pinned version, and needs
`pnpm firebase login` once.

## Who owns what

- **The rules and indexes are TaskMint's.** TaskMint's release deploys them
  (its `Deploy the web app` job), and BudgetMint's pinned copy is only for its
  tests. A rules fix for BudgetMint's data is a TaskMint change and release,
  then `pnpm upstream:pull` here. Never deploy rules from this repository:
  BudgetMint's `firebase.json` has Hosting only, and its deploy account can't.
- **BudgetMint's Hosting site** (`budgetmint`, once registered) is
  BudgetMint's, deployed by its release.
- **The data:** BudgetMint's is under `budgetmint/{uid}`; TaskMint's is under
  `users/{uid}`, and BudgetMint only reads its
  `users/{uid}/published/payoutForecast`.

## Health

- **Releases and deploys:** `gh run list --workflow release.yml`.
- **Usage against the free quotas** (shared with TaskMint): Firebase console
  → Firestore → Usage. BudgetMint reads about 100 to 200 documents when it
  starts and one per change after that; it writes one to three per change.
- **TaskMint's forecast:** a user's Settings → TaskMint says whether it's
  there, which TaskMint version wrote it, and how old TaskMint's last import
  is.

When a quota runs out, Firestore refuses until it resets at midnight
Pacific: BudgetMint shows the saved budget and keeps changes waiting until
then.

## Deploying the web app by hand

From a clean checkout of the release's tag (Hosting serves whatever
`apps/web/dist` holds, so never deploy a working tree's build):

```bash
pnpm install --frozen-lockfile && pnpm build:wasm && pnpm --filter @budgetmint/web build
```

```bash
pnpm firebase deploy --only hosting --project taskmint-f9a05
```

Re-running the tag's `Deploy the web app` job does the same with no local
login.

## Rolling back

- **The web app:** Firebase console → Hosting → the `budgetmint` site's
  release history → the release before → Roll back.
- **The desktop:** installed apps update only to a newer version, so a bad
  release is fixed by releasing the next one (or installing the previous one
  by hand). The data is the cloud's, so reinstalling loses nothing.
- **The rules:** TaskMint's runbook (they're TaskMint's to roll back).

## Users

- **Deleting BudgetMint's data only:** the user's Settings → Account →
  Delete BudgetMint data (it moves the epoch, so their other devices start
  over). By hand:

```bash
pnpm firebase firestore:delete budgetmint/<uid> --recursive --project taskmint-f9a05
```

- **Deleting the account** is TaskMint's while TaskMint has data on it
  (BudgetMint refuses and says so). TaskMint's Delete account deletes
  BudgetMint's data first.

## Recovering data

The project has no Firestore backups set up, and BudgetMint keeps no copy of
its own: the cloud's is the only one, besides each device's cache. So a
mistake is undone in the app (each change's Undo, or by editing the bill), and
a lost `budgetmint/{uid}` tree can't be recovered. Turning on Firestore's
scheduled backups (Blaze plan) is the fix if that ever matters.

## Incidents

- **Every write is refused** ("The cloud refused that change"): the rules
  don't allow what this BudgetMint writes. Check that TaskMint's release with
  the rules for the kind or field is deployed, and that the pin here matches
  (`pnpm upstream:check`). Users keep their budget offline until it's fixed.
- **TaskMint's forecast is missing for everyone:** TaskMint's publisher
  stopped, or its rules refuse it. Check TaskMint's release and its
  `published` rule. BudgetMint goes on as a plain bill tracker.
- **A leaked update signing key:** make a new key, replace the secrets and
  `plugins.updater.pubkey`, and release (the README's "Desktop updates").
- **A leaked Google desktop client secret:** Google treats it as public
  (PKCE protects the flow); to rotate it anyway, reset the secret in Google
  Cloud console → Credentials → BudgetMint desktop, and update `.env` and the
  repository secrets.
