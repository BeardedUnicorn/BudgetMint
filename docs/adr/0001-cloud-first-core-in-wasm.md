# ADR 0001: Cloud-first, with core in WebAssembly everywhere

- **Status:** accepted (2026-11-10)
- **Scope:** where BudgetMint's data lives, where its rules run, and what
  each app's shell does

## Context

BudgetMint is TaskMint's companion: it needs TaskMint's payout forecast,
which only exists in the cloud once TaskMint publishes it, and it should
show the same budget on a phone, a computer and the web. TaskMint keeps its
data in local files and syncs them through its own engine; that took a sync
protocol, conflict handling and epochs in core, and is most of TaskMint's
complexity.

## Decisions

1. **Cloud-first, signed in.** The data is Firestore's, read and written in
   the webview through Firestore's own cache (persistent where the platform
   allows), with no local data files and no sync engine. BudgetMint asks the
   user to sign in before anything else.
2. **One document per entity.** `budgetmint/{uid}/data/{kind~id}` holds the
   settings, each item, and each occurrence the user acted on, as a JSON
   string with the device, epoch and server time. Occurrence ids lead with
   the date, so the app listens to a range of them.
3. **Every rule in `budgetmint-core`.** Recurrence, settlement, TaskMint's
   withdrawal series, the projection, reminders and every change the user
   makes (as planned document writes with their undo) are pure Rust: no
   I/O, clock or randomness. The client asks core and shows the answer.
4. **Core runs in WebAssembly on every platform.** Since the data is in the
   webview everywhere, so is core (1.5 MB, 0.3 MB gzipped). The Tauri shell
   has no data: it shows reminders, keeps the tray, signs in with Google in
   the browser and updates the app.
5. **Epochs.** Deleting the data moves `budgetmint/{uid}` to the next epoch
   and the rules refuse writes from an older one, so a device still open on
   the old data starts over instead of writing it back.

## Consequences

- A first launch needs the network; after that the cache answers offline,
  and writes wait for the connection.
- Reminders differ by platform: only Android's system alarms come with the
  app closed. The desktop keeps running in the tray; the web shows them
  while a tab is open.
- Firestore reads are the cost to watch (about 100 to 200 on a cold start),
  in the Spark quota TaskMint shares.
