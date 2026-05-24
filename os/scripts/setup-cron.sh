#!/usr/bin/env bash
# =============================================================================
# setup-cron.sh — installs cron jobs for Arbor OS on the server
#
# Usage:
#   chmod +x scripts/setup-cron.sh
#   sudo -u <app-user> scripts/setup-cron.sh
#
# What it installs (for the current user's crontab):
#   1. Daily DB backup at 03:00 server time
#   2. Quotation SLA tick every 15 minutes (ops cleanup)
#   3. Quotation expiry tick every hour
#   4. Daily automations at 06:30 server time
#
# Required ENV vars (set them before running, or export in your shell):
#   APP_DIR      — absolute path to the repo root (e.g. /home/arbor/arbor)
#   DATABASE_URL — postgres connection string (used by backup.sh)
#   OPS_BASE_URL — base URL of the running API (e.g. https://api.example.com)
#   OPS_CRON_SECRET — secret for /api/ops/... tick endpoints
#
# Optional:
#   ADMIN_TOKEN         - admin bearer token for /api/automations/run-daily
#   BACKUP_DIR          — where .dump files are stored (default: $APP_DIR/backups)
#   BACKUP_RETAIN_DAYS  — how many days to keep backups (default: 30)
#   BACKUP_ENCRYPT_KEY  — AES-256-CBC encryption key for backup files
# =============================================================================

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
OPS_BASE_URL="${OPS_BASE_URL:-}"
OPS_CRON_SECRET="${OPS_CRON_SECRET:-}"
ADMIN_TOKEN="${ADMIN_TOKEN:-${SMOKE_TOKEN:-}}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
BACKUP_RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"

# ── Validation ────────────────────────────────────────────────────────────────

if [[ -z "$DATABASE_URL" ]]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi
if [[ -z "$OPS_BASE_URL" || -z "$OPS_CRON_SECRET" ]]; then
  echo "WARNING: OPS_BASE_URL or OPS_CRON_SECRET not set — ops tick crons will be skipped."
  SKIP_OPS=1
else
  SKIP_OPS=0
fi
if [[ -z "$OPS_BASE_URL" || -z "$ADMIN_TOKEN" ]]; then
  echo "WARNING: OPS_BASE_URL or ADMIN_TOKEN not set - daily automations cron will be skipped."
  SKIP_DAILY=1
else
  SKIP_DAILY=0
fi

BACKUP_SCRIPT="$APP_DIR/os/scripts/backup.sh"
if [[ ! -x "$BACKUP_SCRIPT" ]]; then
  echo "Making backup.sh executable..."
  chmod +x "$BACKUP_SCRIPT"
fi

# ── Build cron block ──────────────────────────────────────────────────────────

CRON_ENV="DATABASE_URL=\"$DATABASE_URL\" BACKUP_DIR=\"$BACKUP_DIR\" BACKUP_RETAIN_DAYS=\"$BACKUP_RETAIN_DAYS\""
if [[ -n "${BACKUP_ENCRYPT_KEY:-}" ]]; then
  CRON_ENV="$CRON_ENV BACKUP_ENCRYPT_KEY=\"$BACKUP_ENCRYPT_KEY\""
fi

CRON_BLOCK=""

# 1. Daily backup at 03:00
CRON_BLOCK="${CRON_BLOCK}# Arbor OS — daily database backup
0 3 * * * $CRON_ENV $BACKUP_SCRIPT >> /var/log/arbor-backup.log 2>&1
"

# 2. Ops tick jobs (only if OPS vars are set)
if [[ "$SKIP_OPS" -eq 0 ]]; then
  CURL_OPTS="-s --max-time 30 -o /dev/null -w '%{http_code}'"
  TICK_BASE="$OPS_BASE_URL/api/ops"
  SECRET_Q="secret=$OPS_CRON_SECRET"

  CRON_BLOCK="${CRON_BLOCK}
# Arbor OS — quotation SLA tick (every 15 min)
*/15 * * * * curl $CURL_OPTS \"$TICK_BASE/quotation-sla-tick?$SECRET_Q\" >> /var/log/arbor-ops.log 2>&1

# Arbor OS — quotation expiry tick (every hour)
0 * * * * curl $CURL_OPTS \"$TICK_BASE/quotation-expiry-tick?$SECRET_Q\" >> /var/log/arbor-ops.log 2>&1

# Arbor OS — payroll cash reminder tick (daily at 09:00)
0 9 * * * curl $CURL_OPTS \"$TICK_BASE/payroll-cash-reminder-tick?$SECRET_Q\" >> /var/log/arbor-ops.log 2>&1
"
fi

# 4. Daily automations (reminders + operational digest)
if [[ "$SKIP_DAILY" -eq 0 ]]; then
  CRON_BLOCK="${CRON_BLOCK}
# Arbor OS - daily automations and operational digest (daily at 06:30)
30 6 * * * cd \"$APP_DIR\" && PROD_URL=\"$OPS_BASE_URL\" ADMIN_TOKEN=\"$ADMIN_TOKEN\" node os/scripts/trigger-daily-automations.js >> /var/log/arbor-daily-automations.log 2>&1
"
fi

# ── Install into crontab ──────────────────────────────────────────────────────

MARKER_START="# === ARBOR-OS-CRON-START ==="
MARKER_END="# === ARBOR-OS-CRON-END ==="

# Get current crontab (empty string if none)
CURRENT_CRON=$(crontab -l 2>/dev/null || true)

# Remove old arbor block if present
CLEAN_CRON=$(echo "$CURRENT_CRON" | awk "/$MARKER_START/{found=1} !found{print} /$MARKER_END/{found=0}")

# Append new block
NEW_CRON="${CLEAN_CRON}
$MARKER_START
$CRON_BLOCK
$MARKER_END
"

echo "$NEW_CRON" | crontab -

echo ""
echo "✅ Cron jobs installed. Current crontab:"
echo "----------------------------------------------"
crontab -l
echo "----------------------------------------------"
echo ""
echo "Log locations:"
echo "  Backup: /var/log/arbor-backup.log"
[[ "$SKIP_OPS" -eq 0 ]] && echo "  Ops:    /var/log/arbor-ops.log"
[[ "$SKIP_DAILY" -eq 0 ]] && echo "  Daily:  /var/log/arbor-daily-automations.log"
echo ""
echo "To remove Arbor cron jobs, run:"
echo "  crontab -l | grep -v 'ARBOR-OS-CRON' | crontab -"
