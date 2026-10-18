#!/usr/bin/env bash
# Slice 15: bring up compose and verify /health, Grid, reset + DB within 120s.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${DAY1_SALT:-}" || -z "${DAY2_SALT:-}" ]]; then
  echo "DAY1_SALT and DAY2_SALT must be set (use .env at repo root)."
  exit 1
fi

export DAY1_SALT DAY2_SALT

START=$(date +%s)
DEADLINE=$((START + 120))

find . -name '._*' -delete
echo "Starting docker compose (build)..."
docker compose up -d --build \
  postgres redis minio media api worker \
  selenium-hub chrome-node-1 chrome-node-2 firefox-node

wait_until() {
  local desc="$1"
  shift
  while true; do
    if "$@"; then
      echo "OK $desc"
      return 0
    fi
    if [[ $(date +%s) -ge $DEADLINE ]]; then
      echo "TIMEOUT (120s): $desc"
      return 1
    fi
    sleep 2
  done
}

wait_until "GET /health" \
  curl -sf http://127.0.0.1:8080/health | python3 -c "import sys,json; assert json.load(sys.stdin)=={'status':'ok'}"

wait_until "Grid /status (>=3 nodes)" \
  curl -sf http://127.0.0.1:4444/status | python3 -c "import sys,json; v=json.load(sys.stdin)['value']; assert v['ready'] and len(v['nodes'])>=3"

ELAPSED=$(( $(date +%s) - START ))
echo "Stack ready in ${ELAPSED}s (within 120s budget)"

exec "$ROOT/scripts/day2_probes.sh"
