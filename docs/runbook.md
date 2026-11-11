# Runbook: BudgetMint on Firebase

How to deploy, watch, recover and lock down BudgetMint's data and web app, in
its own Firebase project `budgetmint`. The design is
[ADR 0001](adr/0001-cloud-first-core-in-wasm.md),
[ADR 0002](adr/0002-taskmint-forecast-and-shared-project.md) and
[ADR 0003](adr/0003-own-firebase-project.md). TaskMint's own runbook covers
TaskMint's project `taskmint-f9a05`, which BudgetMint only reads the forecast
from. Commands run from the repository root. `pnpm firebase` is
firebase-tools at the pinned version, and needs `pnpm firebase login` once
(`pnpm firebase login --reauth` when it says the login has run out).

## Who owns what

- **BudgetMint's project, `budgetmint`:** its accounts, its Firestore rules
  (`rules/firestore.rules`) and its Hosting site `budgetmint` (at
  https://budgetmint.web.app), all deployed by its release's `Deploy the web
  app` job (rules first), as TaskMint's are by its own (the README's "The web
  app"). Its deploy account can deploy Hosting and the rules and nothing
  else.
- **TaskMint's project, `taskmint-f9a05`:** TaskMint's. Its rules are
  TaskMint's to change and deploy; `firebase/` here is a pinned copy for the
  tests. BudgetMint signs in to it alongside, reads
  `users/{uid}/published/payoutForecast` with TaskMint's uid, and writes
  nothing there.
- **The data:** BudgetMint's is under `budgetmint/{uid}` in `budgetmint`.

## Health

- **Releases and deploys:** `gh run list --workflow release.yml`.
- **Usage against the free quotas** (BudgetMint's own): Firebase console
  → `budgetmint` → Firestore → Usage. BudgetMint reads about 100 to 200 documents when it
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
pnpm firebase deploy --only firestore:rules --project budgetmint
```

```bash
pnpm firebase deploy --only hosting --project budgetmint
```

Re-running the tag's `Deploy the web app` job does the same with no local
login.

Then check the site answers, with the headers `firebase.json` sets:

```bash
curl -sI https://budgetmint.web.app/ https://budgetmint.web.app/privacy https://budgetmint.web.app/sw.js | grep -iE '^(HTTP|cache-control)'
```

The web app's service worker (`apps/web/src/offline/`) keeps each release's
files in a cache of its own: an open tab goes on with the release it started
with, and the next one takes over once every BudgetMint tab has closed.

## Rolling back

- **The web app:** Firebase console → Hosting → the `budgetmint` site's
  release history → the release before → Roll back.
- **The desktop:** installed apps update only to a newer version, so a bad
  release is fixed by releasing the next one (or installing the previous one
  by hand). Pull its update first (below), so no more apps install it
  meanwhile. The data is the cloud's, so reinstalling loses nothing.
- **The rules:** Firebase console → `budgetmint` → Firestore → Rules → the
  version before → Publish. Or deploy the previous tag's
  `rules/firestore.rules` as above.

## Pulling a bad desktop update

Installed apps read `latest.json` from the latest GitHub release, at launch
and once a day, and offer whatever newer version it names. To stop a bad
release spreading, make the release before it the latest again (its
`latest.json` names an older version, so no app is offered the bad one any
more), and mark the bad one a pre-release:

```bash
gh release edit v<good> --latest
```

```bash
gh release edit v<bad> --prerelease
```

Check what installed apps now see:

```bash
curl -sL https://github.com/BeardedUnicorn/BudgetMint/releases/latest/download/latest.json | head -3
```

If there's no earlier release to fall back on, delete the bad release's
`latest.json` instead (`gh release delete-asset v<bad> latest.json --yes`):
apps then find no update. Apps that already installed the bad version stay
on it until the fix: release the next version as usual, which makes it the
latest, and they update to it.

## Users

- **Deleting BudgetMint's data only:** the user's Settings → Account →
  Delete BudgetMint data (it moves the epoch, so their other devices start
  over). By hand:

```bash
pnpm firebase firestore:delete budgetmint/<uid> --recursive --project budgetmint
```

- **Deleting the account:** Settings → Account → Delete account deletes the
  data and the BudgetMint account, and only signs out of TaskMint. By hand,
  delete the data as above, then the user in Firebase console → `budgetmint`
  → Authentication.

## Recovering data

The project has no Firestore backups set up, and BudgetMint keeps no copy of
its own: the cloud's is the only one, besides each device's cache. So a
mistake is undone in the app (each change's Undo, or by editing the bill), and
a lost `budgetmint/{uid}` tree can't be recovered. Turning on Firestore's
scheduled backups (Blaze plan) is the fix if that ever matters.

## Incidents

- **Every write is refused** ("The cloud refused that change"): the rules
  don't allow what this BudgetMint writes. Check that the release's
  `rules/firestore.rules` is deployed to `budgetmint` (the release's
  `Deploy the web app` job, or by hand as above). Users keep their budget
  offline until it's fixed.
- **TaskMint's forecast is missing for everyone:** TaskMint's publisher
  stopped, or its rules refuse it. Check TaskMint's release and its
  `published` rule. BudgetMint goes on as a plain bill tracker.
- **Nobody is signed in to TaskMint after signing in** (Settings → TaskMint
  says Not signed in, though the accounts match): TaskMint's project refuses
  BudgetMint's sign-in. With Google, check that each project's Google
  provider safelists the other's client (the README's "Firebase setup still
  to do"); with email, that TaskMint's Email/Password sign-in is on.
- **A leaked update signing key:** make a new key, replace the secrets and
  `plugins.updater.pubkey`, and release (the README's "Desktop updates").
- **A leaked Google desktop client secret:** Google treats it as public
  (PKCE protects the flow); to rotate it anyway, reset the secret in Google
  Cloud console → Credentials → BudgetMint desktop, and update `.env` and the
  repository secrets.
- **The deploy path is misused or leaks** (an unexpected Hosting or rules
  release, or a compromised workflow dependency). Stop it at once, then look:

```bash
gcloud iam workload-identity-pools providers update-oidc budgetmint-releases --location=global --workload-identity-pool=github --project=budgetmint --disabled
```

  Roll back the site and the rules (above), and check Cloud Logging's audit
  logs for the `github-deploy@budgetmint.iam.gserviceaccount.com` service
  account. `--no-disabled` turns it back on. The provider trusts only this
  repository's `v*` tags, so a tag pushed by someone with write access is
  the other way in: check the repository's tags and collaborators too.

## Moving from TaskMint's project

Done once, when the first release on `budgetmint` is out. Until then,
BudgetMint's accounts are TaskMint's and its data is `budgetmint/` in
`taskmint-f9a05`. Copying both over keeps every uid and password, so
everyone signs in as before and finds their budget.

1. **Stop using the old BudgetMint** (1.5.0 and earlier) everywhere: from
   here on, what it writes stays in `taskmint-f9a05`.
2. **The accounts:** export TaskMint's users, keep those with a
   `budgetmint/{uid}` document, and import them into `budgetmint` with
   TaskMint's password hash parameters (Firebase console → `taskmint-f9a05`
   → Authentication → Users → ⋮ → Password hash parameters). The export
   holds password hashes: keep it out of the repository, and delete it after.

```bash
pnpm firebase auth:export /path/outside/the/repo/taskmint-users.json --format=json --project taskmint-f9a05
```

```bash
pnpm firebase auth:import /path/outside/the/repo/budgetmint-users.json --hash-algo=SCRYPT --hash-key=<base64_signer_key> --salt-separator=<base64_salt_separator> --rounds=<rounds> --mem-cost=<mem_cost> --project budgetmint
```

3. **The data:** copy each user's `budgetmint/{uid}` and its `data/`
   documents to `budgetmint` as they are (with an owner's credentials, past
   the rules). Copy no uid that `budgetmint` already has.
4. **Install the new BudgetMint** and sign in: the budget is there, and
   Settings → TaskMint shows the forecast.
5. **Clean up** once it's checked: delete `budgetmint/` in `taskmint-f9a05`
   (`pnpm firebase firestore:delete budgetmint --recursive --project
   taskmint-f9a05`). TaskMint then drops its `budgetmint/` rules and its
   Delete account's BudgetMint step, and `pnpm upstream:pull` here.
