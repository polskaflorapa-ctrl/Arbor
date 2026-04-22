#!/usr/bin/env bash
set -euo pipefail

# Example daily automation trigger for ARBOR-OS production.
# Usage:
#   PROD_URL="https://your-service.onrender.com" ADMIN_TOKEN="..." ./ops/cron-example.sh

: "${PROD_URL:?Missing PROD_URL}"
: "${ADMIN_TOKEN:?Missing ADMIN_TOKEN}"

curl --fail --silent --show-error \
  -X POST "${PROD_URL}/api/automations/run-daily" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json"

echo
echo "Automation run triggered successfully at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
