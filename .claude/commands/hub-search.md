# hub-search — Search the Claude Memory Hub

Searches the central hub for memory entries matching a query, tags, or category.
Uses the circuit breaker pattern with flock (AUDIT-001) to protect against hub outages.
Falls back gracefully to local memory when the hub is unreachable.

## Usage
`/project:hub-search <query>` — search by keyword
`/project:hub-search` — search with no query (returns recent/high-recurrence entries)

---

```bash
#!/usr/bin/env bash
set -euo pipefail

HUB_CONFIG=".claude/hub-config.env"
BREAKER_FILE=".claude/hub-breaker.json"
LOCK_FILE="/tmp/claude-hub-breaker-$(basename "$(pwd)").lock"

if [ ! -f "$HUB_CONFIG" ]; then
  echo "❌ Hub not configured. Run the bootstrap script first."
  exit 1
fi
# shellcheck source=/dev/null
source "$HUB_CONFIG"

QUERY="${1:-}"

# ── Circuit breaker read (AUDIT-001: flock) ────────────────────────────────
(
  flock -x 200

  # AUDIT-017: Corrupted JSON recovery
  if ! jq empty "$BREAKER_FILE" 2>/dev/null; then
    printf '{"state":"closed","failures":0,"last_trip":""}' > "$BREAKER_FILE"
  fi

  STATE=$(jq -r    '.state'     "$BREAKER_FILE")
  FAILURES=$(jq -r '.failures'  "$BREAKER_FILE")
  LAST_TRIP=$(jq -r '.last_trip' "$BREAKER_FILE")

  # AUDIT-018: Clock skew guard
  if [ "$STATE" = "open" ] && [ -n "$LAST_TRIP" ] && [ "$LAST_TRIP" != "null" ] && [ "$LAST_TRIP" != "" ]; then
    TRIP_EPOCH=$(date -d "$LAST_TRIP" +%s 2>/dev/null || echo 0)
    NOW_EPOCH=$(date +%s)
    [ "$TRIP_EPOCH" -gt "$NOW_EPOCH" ] && TRIP_EPOCH=$(( NOW_EPOCH - 301 ))
    ELAPSED=$(( NOW_EPOCH - TRIP_EPOCH ))
    if [ "$ELAPSED" -ge 300 ]; then
      STATE="half-open"
      jq -n --arg s "half-open" --argjson f "$FAILURES" --arg t "$LAST_TRIP" \
        '{"state":$s,"failures":$f,"last_trip":$t}' > "$BREAKER_FILE"
    fi
  fi

  printf '%s' "$STATE" > /tmp/.hub-search-state-$$

) 200>"$LOCK_FILE"

STATE=$(cat /tmp/.hub-search-state-$$; rm -f /tmp/.hub-search-state-$$)

if [ "$STATE" = "open" ]; then
  echo "⚡ Hub circuit OPEN — hub search unavailable. Searching local memory only."
  exit 0
fi

# ── AUDIT-014: Cert expiry check ──────────────────────────────────────────
CERT_PATH="${HUB_CERT_DIR:-$HOME/.claude-hub-certs}/client.crt"
if [ -f "$CERT_PATH" ]; then
  EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_PATH" | cut -d= -f2)
  DAYS_LEFT=$(( ($(date -d "$EXPIRY" +%s) - $(date +%s)) / 86400 ))
  if [ "$DAYS_LEFT" -le 0 ]; then
    echo "❌ Client certificate EXPIRED. Hub search blocked."
    echo "   Run: ./gen-certs.sh --client $(hostname) on the hub machine."
    exit 1
  elif [ "$DAYS_LEFT" -lt 30 ]; then
    echo "⚠️  Cert expires in $DAYS_LEFT days — regenerate soon."
  fi
fi

# ── Search ─────────────────────────────────────────────────────────────────
PAYLOAD=$(jq -n --arg q "$QUERY" '{"query":$q,"limit":20}')

RESPONSE=$(curl -s -w "\n%{http_code}" \
  --cert   "$CERT_PATH" \
  --key    "${HUB_CERT_DIR:-$HOME/.claude-hub-certs}/client.key" \
  --cacert "${HUB_CERT_DIR:-$HOME/.claude-hub-certs}/ca.crt" \
  -H "X-API-Key: $HUB_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$HUB_URL/api/search" 2>/dev/null || printf '\n000')

HTTP_STATUS=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

# ── Update circuit breaker on result (AUDIT-001: flock on write) ───────────
(
  flock -x 200

  if ! jq empty "$BREAKER_FILE" 2>/dev/null; then
    printf '{"state":"closed","failures":0,"last_trip":""}' > "$BREAKER_FILE"
  fi

  CUR_FAILURES=$(jq -r '.failures' "$BREAKER_FILE")

  if [ "$HTTP_STATUS" != "200" ]; then
    NEW_FAILURES=$(( CUR_FAILURES + 1 ))
    if [ "$NEW_FAILURES" -ge 3 ]; then
      NEW_STATE="open"
      LAST_TRIP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
      echo "⚡ Circuit breaker OPENED"
    else
      NEW_STATE="closed"
      LAST_TRIP=$(jq -r '.last_trip' "$BREAKER_FILE")
    fi
    jq -n --arg s "$NEW_STATE" --argjson f "$NEW_FAILURES" --arg t "$LAST_TRIP" \
      '{"state":$s,"failures":$f,"last_trip":$t}' > "$BREAKER_FILE"
    echo "❌ Hub search failed (HTTP $HTTP_STATUS). Using local memory only."
    exit 1
  else
    printf '{"state":"closed","failures":0,"last_trip":""}' > "$BREAKER_FILE"
  fi

) 200>"$LOCK_FILE"

# ── Display results ────────────────────────────────────────────────────────
COUNT=$(echo "$BODY" | jq -r '.count // 0')
echo "🔍 Hub search: $COUNT result(s) for \"$QUERY\""
echo ""
echo "$BODY" | jq -r '
  .results[] |
  "[\(.category)] \(.title)",
  "  Tags: \(.tags | join(", "))",
  "  Recurrence: \(.recurrence_count)  Confidence: \(.confidence_score)  Last seen: \(.last_seen)",
  ""
' 2>/dev/null || echo "$BODY"
```
