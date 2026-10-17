#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/backend"

if [ ! -d node_modules ]; then
  npm ci
fi

TEST_FILES=()
while IFS= read -r file; do TEST_FILES+=("$file"); done < <(find "$ROOT/tests" -name '*.test.ts' -not -name '._*' | sort)

# Suites share one Postgres and call reset(). Run one file at a time so those resets cannot overlap.
node --import tsx --test --test-concurrency=1 "${TEST_FILES[@]}"
