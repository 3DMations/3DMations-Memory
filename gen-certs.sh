#!/usr/bin/env bash
# gen-certs.sh — Generate mTLS certificates for Claude Memory Hub
#
# Usage:
#   ./gen-certs.sh                    # Generate CA + server cert (run once on hub machine)
#   ./gen-certs.sh --client NAME      # Generate client cert for machine NAME
#
# AUDIT-013: CN collision check prevents two machines sharing a rate-limit bucket.
# AUDIT-014: Cert expiry displayed after generation; pre-call check is in hub commands.
set -euo pipefail

CERT_DIR="./certs"
CLIENT_DIR="$CERT_DIR/clients"
DAYS_CA=3650    # 10 years for CA
DAYS_CERT=365   # 1 year for server/client certs

mkdir -p "$CERT_DIR" "$CLIENT_DIR"

if [ "${1:-}" = "--client" ]; then
    CLIENT_NAME="${2:?Usage: $0 --client <machine-name>}"

    # AUDIT-013: Check for CN collision before generating
    for existing in "$CLIENT_DIR"/*/client.crt; do
        [ -f "$existing" ] || continue
        if openssl x509 -noout -subject -in "$existing" 2>/dev/null \
           | grep -qE "CN\s*=\s*$CLIENT_NAME(\s|,|$)"; then
            echo "ERROR: Certificate with CN=$CLIENT_NAME already exists at $existing"
            echo "Use a unique machine name or delete the existing cert first."
            exit 1
        fi
    done

    CLIENT_OUT="$CLIENT_DIR/$CLIENT_NAME"
    mkdir -p "$CLIENT_OUT"

    echo "Generating client cert for: $CLIENT_NAME"
    openssl genrsa -out "$CLIENT_OUT/client.key" 4096
    openssl req -new -key "$CLIENT_OUT/client.key" \
        -subj "/C=US/CN=$CLIENT_NAME" \
        -out "$CLIENT_OUT/client.csr"
    openssl x509 -req -in "$CLIENT_OUT/client.csr" \
        -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" \
        -CAcreateserial \
        -out "$CLIENT_OUT/client.crt" \
        -days "$DAYS_CERT" -sha256
    rm "$CLIENT_OUT/client.csr"

    # AUDIT-014: Display expiry
    EXPIRY=$(openssl x509 -enddate -noout -in "$CLIENT_OUT/client.crt" | cut -d= -f2)
    DAYS_LEFT=$(( ($(date -d "$EXPIRY" +%s) - $(date +%s)) / 86400 ))
    echo "Client cert for '$CLIENT_NAME' generated. Expires in $DAYS_LEFT days ($EXPIRY)."
    echo "Files:"
    echo "  $CLIENT_OUT/client.key"
    echo "  $CLIENT_OUT/client.crt"
    echo "  $CERT_DIR/ca.crt  (also needed on client)"
    echo ""
    echo "Copy to client machine:"
    echo "  scp $CLIENT_OUT/client.key $CLIENT_OUT/client.crt $CERT_DIR/ca.crt user@$CLIENT_NAME:~/.claude-hub-certs/"
    exit 0
fi

# Generate CA (if not already present)
if [ ! -f "$CERT_DIR/ca.key" ]; then
    echo "Generating CA..."
    openssl genrsa -out "$CERT_DIR/ca.key" 4096
    openssl req -new -x509 -days "$DAYS_CA" \
        -key "$CERT_DIR/ca.key" \
        -subj "/C=US/CN=3DMations-Memory-CA" \
        -out "$CERT_DIR/ca.crt"
    echo "CA generated: $CERT_DIR/ca.crt"
else
    echo "CA already exists at $CERT_DIR/ca.crt — skipping CA generation."
fi

# Generate server cert
if [ ! -f "$CERT_DIR/server.key" ]; then
    echo "Generating server cert..."
    cat > /tmp/hub-server-ext.cnf <<'EOF'
[req]
req_extensions = v3_req
[v3_req]
subjectAltName = @alt_names
[alt_names]
DNS.1 = memory-hub
DNS.2 = memory-gateway
DNS.3 = localhost
IP.1  = 127.0.0.1
EOF
    openssl genrsa -out "$CERT_DIR/server.key" 4096
    openssl req -new -key "$CERT_DIR/server.key" \
        -subj "/C=US/CN=memory-hub" \
        -out /tmp/hub-server.csr
    openssl x509 -req -in /tmp/hub-server.csr \
        -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" \
        -CAcreateserial \
        -out "$CERT_DIR/server.crt" \
        -days "$DAYS_CERT" -sha256 \
        -extfile /tmp/hub-server-ext.cnf \
        -extensions v3_req
    rm /tmp/hub-server.csr /tmp/hub-server-ext.cnf
    echo "Server cert generated: $CERT_DIR/server.crt"
else
    echo "Server cert already exists at $CERT_DIR/server.crt — skipping."
fi

echo ""
echo "Setup complete. Next steps:"
echo "  1. Generate client certs:  ./gen-certs.sh --client <machine-name>"
echo "  2. Start the hub:          docker compose up -d"
echo "  3. Run bootstrap on each client machine using hub-bootstrap.sh"
