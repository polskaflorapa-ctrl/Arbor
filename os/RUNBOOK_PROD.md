# ARBOR-OS Production Runbook

## Deploy
- Render -> `arbor-os` -> Manual Deploy -> Deploy latest commit.
- Verify deployment commit hash matches expected release.

## Mandatory Post-Deploy Checks
- `GET /` returns service metadata JSON.
- `GET /api/ready` returns `status: ready`.
- `GET /api/health` returns `status: ok`.
- `GET /app` loads login screen.

## CLI Smoke Test
Run from local workstation:

```bash
npm run smoke:prod -- https://<prod-url> <ADMIN_TOKEN>
```

Expected: all checks marked `OK`.

## Daily Operations
- Trigger daily automations:
  - `POST /api/automations/run-daily` with admin bearer token
  - schedule at 07:00 local time
- GitHub Actions (repo secrets `PROD_URL`, `ADMIN_TOKEN`): workflow `.github/workflows/daily-automations.yml` (cron UTC + ręcznie *Run workflow*). Lokalnie: `npm run automations:daily -- https://<prod-url> <ADMIN_TOKEN>`.
- Review dashboard KPI and AI plan in `/app`.
- Review audit logs in `Audyt` panel.

## Monitoring and Alerts
- Uptime check every 60s: `GET /api/ready`.
- Alert after 3 consecutive failures.
- Enable metrics only when secured:
  - `METRICS_ENABLED=true`
  - protect `/api/metrics` with network/access policy.

## Incident Triage
1. Check Render deploy logs for startup errors.
2. Verify DB env:
   - `DATABASE_URL`
   - `DB_NAME=arbor_db`
3. Verify database exists on Postgres instance.
4. Run smoke endpoint:
   - `GET /api/ops/smoke` with admin token.

## Rollback
- Render -> Deploys -> choose last stable deploy -> Redeploy.
- Re-run mandatory post-deploy checks.
