#!/usr/bin/env bash
# Live-stack Day 2 probes (Slice 15). Requires API on :8080 and Grid on :4444.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API="${API_BASE:-http://127.0.0.1:8080}"
HUB="${GRID_HUB:-http://127.0.0.1:4444}"

echo "== Day 2 probes (API=$API, Grid=$HUB) =="

curl -sf "$API/health" | python3 -c "import sys,json; assert json.load(sys.stdin)=={'status':'ok'}, 'health body'"
echo "OK GET /health"

curl -sf "$HUB/status" | python3 -c "
import sys, json
v = json.load(sys.stdin)['value']
assert v['ready'] is True, v
assert len(v['nodes']) >= 3, len(v['nodes'])
print('OK Grid ready, nodes=', len(v['nodes']))
"

EXPECTED_RESET='{"status":"reset_complete","seed":42,"sports":["football","basketball","cricket","esports"],"tenants":["tenant-alpha","tenant-beta"],"stock":{"var-jersey-001-M":1,"var-jersey-001-L":5}}'
RESET_JSON="$(curl -sf -X POST "$API/audit/v1/reset" -H 'Content-Type: application/json' -d '{}')"
python3 -c "import json,sys; exp=json.loads(sys.argv[1]); got=json.loads(sys.argv[2]); assert got==exp, (got, exp)" "$EXPECTED_RESET" "$RESET_JSON"
echo "OK POST /audit/v1/reset (Saturday JSON)"

curl -sf "$API/audit/v1/score/match-m1" | python3 -c "
import sys, json
s = json.load(sys.stdin)
assert s.get('status') == 'in_progress', s
assert s['home']['score'] == 1 and s['away']['score'] == 0, s
print('OK GET /audit/v1/score/match-m1 (1-0 in_progress)')
"

curl -sf "$API/audit/v1/qr/match-m1?inspect=true" | python3 -c "
import sys, json
q = json.load(sys.stdin)
assert q.get('entity_id') == 'match-m1', q
print('OK GET /audit/v1/qr/match-m1?inspect=true')
"

docker compose exec -T postgres psql -U sideline -d sideline -t -A -c \
  "SELECT id, club_id FROM players WHERE id = 'player-beta-2';" | grep -q 'player-beta-2|club-beta-1'
echo "OK DB player-beta-2 in club-beta-1"

docker compose exec -T postgres psql -U sideline -d sideline -t -A -c \
  "SELECT token, merged, role FROM guest_tokens WHERE token = 'guest_anon_tok_7721';" | grep -q 'guest_anon_tok_7721|f|read-only'
echo "OK DB guest_anon_tok_7721"

if command -v pytest >/dev/null 2>&1; then
  if pytest tests/selenium/test_guest_grid.py -v --tb=no -q 2>&1 | tee /tmp/selenium_probe.log; then
    echo "OK Selenium guest grid (or skipped — see log)"
  else
    if grep -q SKIPPED /tmp/selenium_probe.log && ! grep -q FAILED /tmp/selenium_probe.log; then
      echo "SKIP Selenium (all skipped)"
    else
      echo "WARN Selenium pytest had failures — review /tmp/selenium_probe.log"
      exit 1
    fi
  fi
else
  echo "SKIP Selenium (pytest not installed)"
fi

echo "== Day 2 probes passed =="
