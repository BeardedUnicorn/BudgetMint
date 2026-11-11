#!/usr/bin/env bash
# Regenerates packages/contracts/src/generated from crates/budgetmint-core
# (tests/contracts.rs) and fails if that changes anything: the TypeScript must
# be committed exactly as the Rust generates it.
set -euo pipefail
cd "$(dirname "$0")/.."

dir=packages/contracts/src/generated
cargo test -q -p budgetmint-core --features ts --test contracts
if ! git diff --quiet -- "$dir" || [ -n "$(git ls-files --others --exclude-standard -- "$dir")" ]; then
  git status --short -- "$dir"
  echo "The generated contracts changed: commit $dir as the Rust now generates it." >&2
  exit 1
fi
echo "Contracts match the Rust"
