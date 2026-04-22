# Deploy Checklist (Render)

## 1) Database
- Open Render Postgres service (`arbor-postgres`).
- Ensure target DB exists (`arbor_db`).
- Copy `Internal Database URL` from the DB service.

## 2) Web Service Environment (`arbor-os`)
- Set `DATABASE_URL` to the copied internal URL (database should be `arbor_db`).
- Set `DB_NAME=arbor_db`.
- Ensure there are no duplicate `DATABASE_URL` or `DB_NAME` entries.
- Keep `JWT_SECRET` configured.

## 3) Deploy
- Run `Manual Deploy` -> `Deploy latest commit`.

## 4) Smoke Checks
- `GET /` should return service metadata JSON.
- `GET /api/ready` should return `status: ready`.
- `GET /api/health` should return `status: ok`.
- `GET /api/ops/smoke` should return `status: ok` (admin token required).
- Verify core login flow in app (`/app`).
- Optional CLI check: `npm run smoke:prod -- https://<service>.onrender.com <ADMIN_TOKEN>`.

## 5) Troubleshooting
- If you see `database "...\" does not exist`, verify both:
  - `DATABASE_URL` database name
  - `DB_NAME` value
- If root shows not found, verify latest commit was deployed.
- Enable metrics in Render (`METRICS_ENABLED=true`) only when `/api/metrics` is protected by network/access policy.
