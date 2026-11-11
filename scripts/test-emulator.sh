#!/usr/bin/env bash
# On the Auth and Firestore emulators, in a fresh emulator: BudgetMint's rules'
# own tests (rules/firestore.rules.test.mjs), then the client's
# *.emulator.test.ts, BudgetMint's real store against its rules and against
# TaskMint's (the pinned copy in firebase/, which the test loads for TaskMint's
# project). The emulator needs Java 21 or later: the java on PATH, or
# Homebrew's openjdk when that one is older. Core's wasm must be built first
# (pnpm build:wasm).
set -euo pipefail
cd "$(dirname "$0")/.."

java_major() { "$1" -version 2>&1 | sed -nE 's/.*version "([0-9]+).*/\1/p' | head -1; }

if [ "$(java_major java || echo 0)" -lt 21 ]; then
  brew_java=/opt/homebrew/opt/openjdk/bin/java
  if [ -x "$brew_java" ] && [ "$(java_major "$brew_java")" -ge 21 ]; then
    export PATH="$(dirname "$brew_java"):$PATH"
  else
    echo "The Firestore emulator needs Java 21 or later (brew install openjdk)" >&2
    exit 1
  fi
fi

exec pnpm firebase --config firebase.emulators.json emulators:exec --project demo-budgetmint --only auth,firestore \
  "node --test rules/firestore.rules.test.mjs && BUDGETMINT_EMULATOR=1 pnpm --filter @budgetmint/client exec vitest run"
