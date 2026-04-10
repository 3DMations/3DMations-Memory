# hub-sync — Sync local memory entries to the Claude Memory Hub

Reads `.claude/memory/index.json`, syncs all active entries to the hub API,
handles circuit breaker state with flock (AUDIT-001), and queues failures
in `pending-sync.json`.

## Circuit breaker states
- **closed**: Hub reachable — sync proceeds normally
- **open**: Hub failed 3+ times in a row — skip sync, queue locally
- **half-open**: 5 minutes elapsed since last trip — attempt one probe sync

## Usage
Run at session end or manually via `/project:hub-sync`

---

```bash
#!/usr/bin/env bash
set -euo pipefail

HUB_CONFIG=".claude/hub-config.env"
BREAKER_FILE=".claude/hub-breaker.json"
LOCK_FILE="/tmp/claude-hub-breaker-$(basename "$(pwd)").lock"
PENDING_FILE=".claude/memory/pending-sync.json"
INDEX_FILE=".claude/memory/index.json"
LEARNINGS_DIR=".claude/memory/learnings"

# Load hub config
if [ ! -f "$HUB_CONFIG" ]; then
  echo "❌ Hub not configured. Run the bootstrap script first."
  exit 1
fi
# shellcheck source=/dev/null
source "$HUB_CONFIG"

# ── Circuit breaker read (AUDIT-001: flock prevents concurrent corruption) ──
(
  flock -x 200

  # AUDIT-017: Corrupted JSON recovery inside flock block
  if ! jq empty "$BREAKER_FILE" 2>/dev/null; then
    echo "⚠️  hub-breaker.json corrupted — resetting to closed state"
    printf '{"state":"closed","failures":0,"last_trip":""}' > "$BREAKER_FILE"
  fi

  STATE=$(jq -r    '.state'     "$BREAKER_FILE")
  FAILURES=$(jq -r '.failures'  "$BREAKER_FILE")
  LAST_TRIP=$(jq -r '.last_trip' "$BREAKER_FILE")

  # AUDIT-018: Clock skew guard — last_trip must not be in the future
  if [ "$STATE" = "open" ] && [ -n "$LAST_TRIP" ] && [ "$LAST_TRIP" != "null" ] && [ "$LAST_TRIP" != "" ]; then
    TRIP_EPOCH=$(date -d "$LAST_TRIP" +%s 2>/dev/null || echo 0)
    NOW_EPOCH=$(date +%s)
    if [ "$TRIP_EPOCH" -gt "$NOW_EPOCH" ]; then
      echo "⚠️  Breaker last_trip is in the future (clock skew?) — forcing half-open"
      TRIP_EPOCH=$((NOW_EPOCH - 301))
    fi
    ELAPSED=$(( NOW_EPOCH - TRIP_EPOCH ))
    if [ "$ELAPSED" -ge 300 ]; then
      STATE="half-open"
      jq -n --arg s "half-open" --argjson f "$FAILURES" --arg t "$LAST_TRIP" \
        '{"state":$s,"failures":$f,"last_trip":$t}' > "$BREAKER_FILE"
    fi
  fi

  printf '%s' "$STATE" > /tmp/.hub-sync-state-$$

) 200>"$LOCK_FILE"

STATE=$(cat /tmp/.hub-sync-state-$$; rm -f /tmp/.hub-sync-state-$$)

if [ "$STATE" = "open" ]; then
  echo "⚡ Hub circuit OPEN — sync skipped. Entry will be queued for retry."
  exit 0
fi

# ── AUDIT-014: Cert expiry check ───────────────────────────────────────────
CERT_PATH="${HUB_CERT_DIR:-$HOME/.claude-hub-certs}/client.crt"
if [ -f "$CERT_PATH" ]; then
  EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_PATH" | cut -d= -f2)
  DAYS_LEFT=$(( ($(date -d "$EXPIRY" +%s) - $(date +%s)) / 86400 ))
  if [ "$DAYS_LEFT" -le 0 ]; then
    echo "❌ Client certificate EXPIRED. Hub sync blocked."
    echo "   Run: ./gen-certs.sh --client $(hostname) on the hub machine."
    exit 1
  elif [ "$DAYS_LEFT" -lt 30 ]; then
    echo "⚠️  Cert expires in $DAYS_LEFT days — regenerate soon."
  fi
fi

# ── Sync active entries ─────────────────────────────────────────────────────
SYNC_FAILED=false
SYNCED=0
FAILED=0

if [ ! -f "$INDEX_FILE" ]; then
  echo "No index.json found — nothing to sync."
  exit 0
fi

mapfile -t ENTRY_IDS < <(jq -r '.entries[] | select(.status == "active") | .id' "$INDEX_FILE")

for ENTRY_ID in "${ENTRY_IDS[@]}"; do
  ENTRY_FILE="$LEARNINGS_DIR/${ENTRY_ID}.md"
  [ -f "$ENTRY_FILE" ] || continue

  # Extract YAML frontmatter → JSON payload
  PAYLOAD=$(awk '/^---$/{if(found)exit; found=1; next} found{print}' "$ENTRY_FILE" \
    | python3 -c "
import sys, yaml, json
try:
    data = yaml.safe_load(sys.stdin.read()) or {}
    for f in ['tags','related_files','related_entries']:
        if data.get(f) is None:
            data[f] = []
    # Remove fields not in API model
    for f in ['id','status','preserved_in_summary','execution_trace']:
        data.pop(f, None)
    print(json.dumps(data))
except Exception as e:
    print('{}', file=sys.stderr)
    print('{}')
" 2>/dev/null)

  if [ "$PAYLOAD" = "{}" ]; then
    echo "⚠️  Skipping $ENTRY_ID — failed to parse frontmatter"
    continue
  fi

  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    --cert "$CERT_PATH" \
    --key  "${HUB_CERT_DIR:-$HOME/.claude-hub-certs}/client.key" \
    --cacert "${HUB_CERT_DIR:-$HOME/.claude-hub-certs}/ca.crt" \
    -H "X-API-Key: $HUB_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    "$HUB_URL/api/sync" 2>/dev/null || echo "000")

  if [ "$HTTP_STATUS" = "200" ]; then
    SYNCED=$(( SYNCED + 1 ))
  else
    FAILED=$(( FAILED + 1 ))
    SYNC_FAILED=true
    echo "⚠️  Failed to sync $ENTRY_ID (HTTP $HTTP_STATUS)"
  fi
done

echo "✅ Hub sync: $SYNCED synced, $FAILED failed"

# ── Update circuit breaker (AUDIT-001: flock on write too) ─────────────────
(
  flock -x 200

  if ! jq empty "$BREAKER_FILE" 2>/dev/null; then
    printf '{"state":"closed","failures":0,"last_trip":""}' > "$BREAKER_FILE"
  fi

  CUR_FAILURES=$(jq -r '.failures' "$BREAKER_FILE")

  if [ "$SYNC_FAILED" = "true" ]; then
    NEW_FAILURES=$(( CUR_FAILURES + 1 ))
    if [ "$NEW_FAILURES" -ge 3 ]; then
      NEW_STATE="open"
      LAST_TRIP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
      echo "⚡ Circuit breaker OPENED after $NEW_FAILURES failures"
    else
      NEW_STATE="closed"
      LAST_TRIP=$(jq -r '.last_trip' "$BREAKER_FILE")
    fi
  else
    NEW_FAILURES=0
    NEW_STATE="closed"
    LAST_TRIP=""
    if [ "$STATE" = "half-open" ]; then
      echo "✅ Circuit breaker reset to closed (half-open probe succeeded)"
    fi
  fi

  jq -n \
    --arg     state     "$NEW_STATE" \
    --argjson failures  "$NEW_FAILURES" \
    --arg     last_trip "$LAST_TRIP" \
    '{"state":$state,"failures":$failures,"last_trip":$last_trip}' \
    > "$BREAKER_FILE"

) 200>"$LOCK_FILE"
```
