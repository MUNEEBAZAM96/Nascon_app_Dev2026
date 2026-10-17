#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/backend"

if [ ! -d node_modules ]; then
  npm ci
fi

TEST_FILES=()
while IFS= read -r file; do TEST_FILES+=("$file"); done < <(find "$ROOT/tests" -name '*.test.ts' -not -name '._*' | sort)

node --import tsx --test "${TEST_FILES[@]}"
