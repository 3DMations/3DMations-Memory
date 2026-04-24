#!/usr/bin/env bash
# backup-hub-db.sh — local PostgreSQL backup for the 3DMations Memory Hub
# Addresses AUDIT-007. Creates a timestamped pg_dump (custom format, compressed)
# of the claude_memory database from the memory-db container into ./backups/.
#
# Usage:
#   scripts/backup-hub-db.sh
#   BACKUPS_DIR=/mnt/external/hub-backups scripts/backup-hub-db.sh
#
# Restore example (run manually, NOT by this script):
#   docker cp backups/hub-<timestamp>.dump memory-db:/tmp/restore.dump
#   docker exec memory-db pg_restore -U claude -d claude_memory \
#       --clean --if-exists /tmp/restore.dump
#   docker exec memory-db rm -f /tmp/restore.dump
#
# RETENTION: this script does NOT delete old backups. The Destructive Action
# Guard in CLAUDE.md forbids automated file deletion. Manage retention manually,
# or add a separate opt-in cleanup script with explicit user approval.

set -euo pipefail

CONTAINER="memory-db"
DB_NAME="claude_memory"
DB_USER="claude"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUPS_DIR="${BACKUPS_DIR:-$(cd "$(dirname "$0")/.." && pwd)/backups}"
BACKUP_FILE="${BACKUPS_DIR}/hub-${TIMESTAMP}.dump"
IN_CONTAINER_TMP="/tmp/backup.dump"

err() { printf 'backup-hub-db: ERROR: %s\n' "$*" >&2; }
info() { printf 'backup-hub-db: %s\n' "$*"; }

if ! command -v docker >/dev/null 2>&1; then
    err "docker command not found in PATH"; exit 1
fi
if ! docker info >/dev/null 2>&1; then
    err "docker daemon not reachable (running? are you in the docker group?)"; exit 1
fi
if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
    err "container '${CONTAINER}' is not running; start with: docker compose up -d"
    exit 1
fi

mkdir -p "${BACKUPS_DIR}"

info "dumping ${DB_NAME} from ${CONTAINER} (custom format, compress=9)"
docker exec "${CONTAINER}" pg_dump \
    -U "${DB_USER}" "${DB_NAME}" \
    --format=custom --compress=9 \
    --file="${IN_CONTAINER_TMP}"

info "copying dump out of container -> ${BACKUP_FILE}"
docker cp "${CONTAINER}:${IN_CONTAINER_TMP}" "${BACKUP_FILE}"

# Cleanup of in-container temp file created by THIS script; not a destructive
# action under the Destructive Action Guard (we are removing a file we just
# made, inside ephemeral container storage, with an exact path).
docker exec "${CONTAINER}" rm -f "${IN_CONTAINER_TMP}"

if [[ ! -s "${BACKUP_FILE}" ]]; then
    err "backup file is missing or empty: ${BACKUP_FILE}"
    exit 1
fi

SIZE="$(du -h "${BACKUP_FILE}" | awk '{print $1}')"

info "----------------------------------------"
info "backup complete"
info "  path : ${BACKUP_FILE}"
info "  size : ${SIZE}"
info "restore:"
info "  docker cp '${BACKUP_FILE}' ${CONTAINER}:/tmp/restore.dump"
info "  docker exec ${CONTAINER} pg_restore -U ${DB_USER} -d ${DB_NAME} --clean --if-exists /tmp/restore.dump"
info "  docker exec ${CONTAINER} rm -f /tmp/restore.dump"
info "----------------------------------------"
