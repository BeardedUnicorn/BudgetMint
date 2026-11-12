# ADR 0004: Usage analytics on the web and Android

- **Status:** accepted (2026-11-11)
- **Scope:** what BudgetMint measures about how it's used, where, and how a
  user turns it off

## Context

BudgetMint had no way to see which of its pages are used. TaskMint answers
the same question with Firebase Analytics (TaskMint's ADR 0002, decision 9),
and BudgetMint's Android app is built as TaskMint's, with the same bridges in
`MainActivity.kt`. BudgetMint's data is people's money, so what's measured
has to stay clear of it.

## Decisions

1. **Firebase Analytics, in `budgetmint`'s Google Analytics property.** The
   web app and the Android app send it; the desktop sends nothing: Google's
   tag would run inside a webview that can call every IPC command.
2. **Only page views.** Each page opened is a `screen_view` with the page's
   name (`overview`, `forecast`, …), from `utils/analytics.ts` in the
   client. No bills, amounts, balances, categories, dates or anything else
   of the budget, and no events besides the SDK's own.
3. **On until turned off, per device.** Settings → Privacy → Share usage
   statistics turns it off on that device, at once. The section shows only
   where the shell has analytics.
4. **Android uses the native SDK** through the `BudgetMintAnalytics` bridge
   (`setEnabled`, `screen`); the setting also persists in the SDK.
5. **The web loads Google's tag only once analytics is on**
   (`apps/web/src/analytics.ts`), with automatic page views off, and only
   when the build's Firebase app has a `measurementId` and isn't on the
   emulators. Hosting's CSP (`firebase.json`) lets Google's tag and
   collection hosts in.

## Consequences

- The web's CSP is wider: `www.googletagmanager.com` may run script, and
  Google Analytics' hosts may be connected to and loaded as images.
- The privacy page has to say so (the unmerged public-launch work's
  `privacy.html`).
- Turning analytics off on one device leaves the others as they are.
