#!/usr/bin/env bash
# client-bootstrap.sh — 3DMations Memory Hub client bootstrap.
# Run from a client project root (NOT this repo). Provisions
# .claude/hub-config.env and .claude/hub-breaker.json and verifies mTLS
# to the hub. Rolls back partial state on failure (AUDIT-005) and
# detects expired certs distinctly from network errors (AUDIT-015).
# Exit codes: 0 ok | 1 precondition | 2 cert expired | 3 hub check failed
set -euo pipefail

log() { printf '[client-bootstrap] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit "${2:-1}"; }
usage() {
    echo "Usage: client-bootstrap.sh --hub-url URL --api-key KEY --cert-dir DIR --ca FILE" >&2
    echo "  Env fallbacks: HUB_URL API_KEY CERT_DIR CA. Run from client project root." >&2
}

# --- Argument parsing -------------------------------------------------------
HUB_URL="${HUB_URL:-}"
API_KEY="${API_KEY:-}"
CERT_DIR="${CERT_DIR:-}"
CA="${CA:-}"

while [ $# -gt 0 ]; do
    case "$1" in
        --hub-url)  HUB_URL="${2:-}"; shift 2 ;;
        --api-key)  API_KEY="${2:-}"; shift 2 ;;
        --cert-dir) CERT_DIR="${2:-}"; shift 2 ;;
        --ca)       CA="${2:-}"; shift 2 ;;
        -h|--help)  usage; exit 0 ;;
        *)          usage; die "Unknown argument: $1" 1 ;;
    esac
done

[ -n "$HUB_URL" ]  || { usage; die "--hub-url is required" 1; }
[ -n "$API_KEY" ]  || { usage; die "--api-key is required" 1; }
[ -n "$CERT_DIR" ] || { usage; die "--cert-dir is required" 1; }
[ -n "$CA" ]       || { usage; die "--ca is required" 1; }

# --- Rollback trap (AUDIT-005) — rm targets only files this script creates.
CLEANUP_ON_FAIL=false
trap 'if [ "$CLEANUP_ON_FAIL" = true ]; then
  echo "[client-bootstrap] Bootstrap failed — cleaning up partial state..." >&2
  rm -f ".claude/hub-config.env" ".claude/hub-breaker.json"
  echo "[client-bootstrap] Re-run bootstrap after resolving the failure." >&2
fi' ERR

# --- Precondition checks (no state writes yet) ------------------------------
log "Checking preconditions in $(pwd)"
[ -d ".claude" ] || die ".claude/ not found — initialize this project with Claude Code first." 1
CLIENT_CRT="$CERT_DIR/client.crt"
CLIENT_KEY="$CERT_DIR/client.key"
[ -f "$CLIENT_CRT" ] || die "Client certificate not found: $CLIENT_CRT" 1
[ -f "$CLIENT_KEY" ] || die "Client key not found: $CLIENT_KEY" 1
[ -f "$CA" ]         || die "CA certificate not found: $CA" 1
command -v openssl >/dev/null 2>&1 || die "openssl is required but not installed" 1
command -v curl    >/dev/null 2>&1 || die "curl is required but not installed" 1

# --- Expired cert detection (AUDIT-015) -------------------------------------
NOT_AFTER="$(openssl x509 -in "$CLIENT_CRT" -noout -enddate | cut -d= -f2)"
EXPIRY_EPOCH="$(date -d "$NOT_AFTER" +%s 2>/dev/null || echo 0)"
[ "$EXPIRY_EPOCH" -ne 0 ] || die "Could not parse certificate expiry ($NOT_AFTER)" 1
DAYS_LEFT=$(( (EXPIRY_EPOCH - $(date +%s)) / 86400 ))

if [ "$DAYS_LEFT" -le 0 ]; then
    log "Cannot bootstrap: client certificate is EXPIRED ($((-DAYS_LEFT)) days ago)"
    log "Remediation:"
    log "  1. On the hub machine: ./gen-certs.sh --client \$(hostname)"
    log "  2. scp new certs to $CERT_DIR on this machine"
    log "  3. Re-run this bootstrap script"
    exit 2
fi
if [ "$DAYS_LEFT" -lt 30 ]; then
    log "WARNING: client certificate expires in $DAYS_LEFT days — rotate soon"
else
    log "Client certificate valid for $DAYS_LEFT more days"
fi

# --- State writes begin — arm the rollback trap -----------------------------
CLEANUP_ON_FAIL=true
CONFIG_FILE=".claude/hub-config.env"
BREAKER_FILE=".claude/hub-breaker.json"
TS="$(date +%s)"
for f in "$CONFIG_FILE" "$BREAKER_FILE"; do
    if [ -f "$f" ]; then
        log "Backing up existing $f to ${f}.bak-${TS}"
        cp -p "$f" "${f}.bak-${TS}"
    fi
done
log "Writing $CONFIG_FILE"
umask 077
cat > "$CONFIG_FILE" <<EOF
# 3DMations Memory Hub client config — generated $(date -Iseconds)
HUB_URL="$HUB_URL"
API_KEY="$API_KEY"
CERT_DIR="$CERT_DIR"
CA="$CA"
CLIENT_CRT="$CLIENT_CRT"
CLIENT_KEY="$CLIENT_KEY"
EOF

log "Writing $BREAKER_FILE"
printf '%s\n' '{"state":"closed","failures":0,"last_trip":""}' > "$BREAKER_FILE"

# --- mTLS health check ------------------------------------------------------
log "Testing mTLS connection to $HUB_URL/api/health"
HTTP_CODE="$(curl -sS --max-time 10 \
    --cacert "$CA" \
    --cert "$CLIENT_CRT" \
    --key "$CLIENT_KEY" \
    -H "X-API-Key: $API_KEY" \
    -o /dev/null -w '%{http_code}' \
    "$HUB_URL/api/health" || echo "000")"

if [ "$HTTP_CODE" != "200" ]; then
    log "Hub health check failed (HTTP $HTTP_CODE) — rolling back"
    exit 3
fi

# --- Success — disarm rollback ---------------------------------------------
CLEANUP_ON_FAIL=false
trap - ERR

log "Bootstrap complete. Hub health check returned HTTP 200."
cat >&2 <<'DONE'
[client-bootstrap] Next steps:
  1. Open this project in Claude Code.
  2. Run /hub-sync in the session to send your first entry to the hub.
  3. Run /hub-search <query> to retrieve entries from other clients.
DONE
exit 0
