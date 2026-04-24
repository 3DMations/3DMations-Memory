#!/usr/bin/env bash
# hub-sync-retry.sh — Retry failed client-side syncs from pending-sync.json.
# Resolves AUDIT-004. Run from the root of a client project.
set -euo pipefail

PENDING_FILE=".claude/memory/pending-sync.json"
HUB_CONFIG=".claude/hub-config.env"
LOCK_FILE="/tmp/claude-hub-retry-$(basename "$(pwd)").lock"

log() { printf '[hub-sync-retry] %s\n' "$*" >&2; }

[ -f "$PENDING_FILE" ] || exit 0
if ! jq empty "$PENDING_FILE" 2>/dev/null; then
  log "ERROR: $PENDING_FILE is not valid JSON — leaving untouched"
  exit 0
fi
COUNT=$(jq 'length' "$PENDING_FILE")
[ "$COUNT" -eq 0 ] && exit 0

# Serialize with flock to prevent concurrent runs (AUDIT-001 lesson).
exec 200>"$LOCK_FILE"
if ! flock -n -x 200; then
  log "another retry run is in progress — exiting"
  exit 0
fi

[ -f "$HUB_CONFIG" ] || { log "ERROR: $HUB_CONFIG missing"; exit 0; }
# shellcheck source=/dev/null
source "$HUB_CONFIG"
CERT_DIR="${HUB_CERT_DIR:-$HOME/.claude-hub-certs}"
CERT_PATH="$CERT_DIR/client.crt"
KEY_PATH="$CERT_DIR/client.key"
CA_PATH="${HUB_CA:-$CERT_DIR/ca.crt}"

# AUDIT-014: fail fast on expired client certificate.
[ -f "$CERT_PATH" ] || { log "ERROR: client cert not found at $CERT_PATH"; exit 0; }
EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_PATH" | cut -d= -f2)
EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s 2>/dev/null || echo 0)
if [ "$EXPIRY_EPOCH" -le "$(date +%s)" ]; then
  log "ERROR: client certificate EXPIRED ($EXPIRY) — regenerate via gen-certs.sh"
  exit 2
fi

log "retrying $COUNT queued entries against ${HUB_URL:-<unset>}"
REMAINING=$(mktemp "${TMPDIR:-/tmp}/pending-sync.XXXXXX")
trap 'rm -f "$REMAINING"' EXIT
printf '[]' > "$REMAINING"

SYNCED=0
FAILED=0
for i in $(seq 0 $((COUNT - 1))); do
  PAYLOAD=$(jq -c ".[$i]" "$PENDING_FILE")
  if [ -z "$PAYLOAD" ] || [ "$PAYLOAD" = "null" ]; then
    continue
  fi
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    --cert "$CERT_PATH" --key "$KEY_PATH" --cacert "$CA_PATH" \
    -H "X-API-Key: ${HUB_API_KEY:-}" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    "${HUB_URL:-}/api/sync" 2>/dev/null || echo "000")
  if [[ "$HTTP_STATUS" =~ ^2[0-9][0-9]$ ]]; then
    SYNCED=$((SYNCED + 1))
    log "synced index=$i status=$HTTP_STATUS"
  else
    FAILED=$((FAILED + 1))
    log "retry failed index=$i status=$HTTP_STATUS — leaving in queue"
    TMP=$(mktemp "${TMPDIR:-/tmp}/pending-append.XXXXXX")
    jq --argjson item "$PAYLOAD" '. + [$item]' "$REMAINING" > "$TMP"
    mv "$TMP" "$REMAINING"
  fi
done

# Atomic rewrite: temp file + mv, never in-place.
mv "$REMAINING" "$PENDING_FILE"
trap - EXIT
log "done: $SYNCED synced, $FAILED still queued"
exit 0
