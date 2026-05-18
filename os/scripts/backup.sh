#!/usr/bin/env bash
# ============================================================
# ARBOR-OS — PostgreSQL backup script (EPIC 9 NFR)
#
# Usage:
#   ./scripts/backup.sh
#
# ENV variables (from .env or shell export):
#   DATABASE_URL      — full postgres://... connection string  OR
#   DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD
#   BACKUP_DIR        — target directory (default: ./backups)
#   BACKUP_RETAIN_DAYS — how many days of backups to keep (default: 14)
#   BACKUP_ENCRYPT_KEY — optional: if set, encrypts with openssl AES-256-CBC
#
# Output:
#   $BACKUP_DIR/arbor_YYYY-MM-DD_HH-MM.dump[.enc]
#   $BACKUP_DIR/latest.dump[.enc] — symlink to newest
# ============================================================

set -euo pipefail

# ── Load .env if present ─────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi

# ── Config ───────────────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/../backups}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-14}"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M")
DUMP_FILE="$BACKUP_DIR/arbor_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

# ── Build pg_dump connection args ─────────────────────────────────────────────
if [[ -n "${DATABASE_URL:-}" ]]; then
  PG_ARGS=("$DATABASE_URL")
else
  export PGPASSWORD="${DB_PASSWORD:-postgres}"
  PG_ARGS=(
    -h "${DB_HOST:-localhost}"
    -p "${DB_PORT:-5432}"
    -U "${DB_USER:-postgres}"
    "${DB_NAME:-arbor_db}"
  )
fi

# ── Dump ─────────────────────────────────────────────────────────────────────
echo "[backup] Starting dump → $DUMP_FILE"
pg_dump --format=custom --compress=6 "${PG_ARGS[@]}" -f "$DUMP_FILE"
echo "[backup] Dump complete: $(du -sh "$DUMP_FILE" | cut -f1)"

# ── Optional encryption ───────────────────────────────────────────────────────
if [[ -n "${BACKUP_ENCRYPT_KEY:-}" ]]; then
  ENC_FILE="${DUMP_FILE}.enc"
  openssl enc -aes-256-cbc -salt -pbkdf2 -pass pass:"$BACKUP_ENCRYPT_KEY" \
    -in "$DUMP_FILE" -out "$ENC_FILE"
  rm -f "$DUMP_FILE"
  DUMP_FILE="$ENC_FILE"
  echo "[backup] Encrypted → $DUMP_FILE"
fi

# ── Update latest symlink ─────────────────────────────────────────────────────
ln -sf "$(basename "$DUMP_FILE")" "$BACKUP_DIR/latest.$([ -n "${BACKUP_ENCRYPT_KEY:-}" ] && echo "dump.enc" || echo "dump")"

# ── Rotate old backups ────────────────────────────────────────────────────────
DELETED=$(find "$BACKUP_DIR" -name "arbor_*.dump*" -mtime +"$RETAIN_DAYS" -print -delete | wc -l)
echo "[backup] Rotated $DELETED old backup(s) older than ${RETAIN_DAYS} days"
echo "[backup] Done: $DUMP_FILE"
