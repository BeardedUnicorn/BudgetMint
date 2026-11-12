# Security

## Reporting a vulnerability

Please report it privately, through GitHub:
[report a vulnerability](https://github.com/BeardedUnicorn/BudgetMint/security/advisories/new)
(the repository's **Security** tab → **Report a vulnerability**). Don't open a
public issue for it. Say what's affected and how to reproduce it; the report
stays between you and the maintainer until a fix is released.

## What's covered

- BudgetMint's code here: the web app and its Hosting configuration
  (`firebase.json`), BudgetMint's Firestore rules (`rules/firestore.rules`),
  the desktop app and its updates, core, and the release workflow.
- **Not TaskMint's rules or project:** `firebase/` here is a pinned copy of
  TaskMint's rules, which BudgetMint only reads TaskMint's forecast under.
  Report a problem with them to
  [TaskMint](https://github.com/BeardedUnicorn/taskmint) the same way.

Only the latest release is fixed: the desktop app updates itself, and the web
app is always the latest.

## Not vulnerabilities

- The Firebase web configuration in `apps/*/src/firebaseConfig.ts`, including
  its `apiKey`: it only names the project, and Firebase expects it to be
  public. Each project's Firestore rules keep each account's data its own.
- The desktop's Google OAuth client secret: Google treats a desktop app's
  secret as public, and the sign-in uses PKCE.
