# Coverage policy

Every package is held to **100% coverage**:
- **TypeScript:** lines, branches, functions and statements, measured with vitest v8.
- **Rust:** lines, functions and regions, measured with `cargo llvm-cov` on stable. Stable has no branch metric.

Each Rust crate is measured on its own tests. The desktop run ignores `crates/`, so the core can't be covered by accident through the shell.

Integration tests count toward the total, including the desktop's IPC tests (through Tauri's mock runtime) and the Google sign-in flow against a local stand-in for Google. BudgetMint's rules, and its store's reads and writes against its rules and TaskMint's, are checked on the emulator (`scripts/test-emulator.sh`); that has no coverage metric.

## Rules

1. **No inline ignores.** `v8 ignore`, `istanbul ignore`, `c8 ignore` and `#[coverage(off)]` are banned in source. `scripts/check-coverage-policy.mjs` fails the build if one appears.
2. **Exclusions are files, listed once.** `coverage-policy.json` is the only list. Every package's coverage config reads it, and the check fails if a config drifts from it.
3. **An excluded file holds no logic.** It wires things together and calls tested code. Anything with a branch moves into a tested module.
4. **Delete instead of covering the impossible.** Remove defensive `??`, `?.` or default parameters that the types or the boundaries (serde) make unreachable.
5. **There are no floors.** Every package starts at 100 and stays there.

## How it's wired

- **The list:** [`coverage-policy.json`](../coverage-policy.json) at the repo root.
- **TypeScript:** each package's `vitest.config.ts` calls `defineBudgetmintConfig({ packageDir, … })` from [`vitest.shared.ts`](../vitest.shared.ts). The preset reads the exclusions from the policy and sets every threshold to 100; a package can't pass its own.
- **The check:** [`scripts/check-coverage-policy.mjs`](../scripts/check-coverage-policy.mjs) fails when an inline ignore appears, when a package's vitest config isn't registered in the policy or declares its own coverage, or when a policy entry points at a file that doesn't exist.
- **Rust ignore regex:** `node scripts/check-coverage-policy.mjs --rust-ignore-regex <crate dir>` prints that crate's `--ignore-filename-regex`: its excluded files plus every other crate.
- **Running the gates:** [`scripts/verify.sh`](../scripts/verify.sh) runs all of them, locally and in CI (`.github/workflows/ci.yml` runs it).

## Exclusions

| Package | Excluded | Why | Checked by |
|---|---|---|---|
| `crates/budgetmint-core` | nothing | pure code | – |
| `crates/budgetmint-wasm` | `src/lib.rs` | the `#[wasm_bindgen]` layer over core's tested `host::JsonHost`; it runs only in a wasm engine | the client's tests load the real wasm and run commands through it |
| `packages/client` | `src/core/wasm/**` | wasm-bindgen's generated JavaScript (built, not committed) | the same tests |
| `apps/desktop/src-tauri` | `src/main.rs`, `src/app.rs` | binary entry; `tauri::Builder`, plugins, the menu bar, `generate_context!`, the run loop. They need a real event loop and main thread | [manual QA checklist](qa/excluded-code-checklist.md) |
| `apps/desktop/src-tauri` | `src/platform/os.rs` | the Platform on Tauri (the menus and tray, OS notifications, the window and the Dock icon, the browser, the logs folder, opening at login, the updater). It needs a real UI session, so it holds calls only | [manual QA checklist](qa/excluded-code-checklist.md) |
| `apps/desktop/src-tauri/gen/android` | (implicit) | the Android project's Kotlin: `MainActivity.kt`'s bridges (the launch screen, the status bar, Google sign-in, analytics). Kotlin isn't measured | [manual QA checklist](qa/excluded-code-checklist.md#android) |
| all TS packages | `__tests__/**`, test files, `setupTests.ts`, `*.d.ts` | not shipped runtime code | – |

Each `main.tsx` is **not** excluded: it's a single `startClient` call, covered by a test that imports it.

## Rust specifics

These hold as they did in TaskMint:
- Derived impls are not instrumented, and `log` macros add no uncovered regions.
- `#[cfg(test)]` helpers count, so every helper must run.
- `generate_handler!` expands an error path for each argument of each command: `dispatch`'s IPC tests omit and mistype its arguments.
- **Each function is scored by its best single build, not the union.** Unit tests and integration tests compile the code separately, so one of them must cover the whole function.
- **Every `?`, `let … else` and closure on an error path is a region of its own**; `.expect()` adds none. A lock's poison handler is passed as `PoisonError::into_inner`, a function rather than a closure, so it adds no region.
