# ARBOR-OS

Backend API for ARBOR-OS.

## Quick Start

1. Install dependencies:
   - `npm install`
2. Start server:
   - `npm start`
3. Run tests:
   - `npm test`

## API language (Polish / Ukrainian / Russian)

Error messages for shared middleware and auth flows are localized.

- **Default:** Polish (`pl`) when no language is selected.
- **`Accept-Language`:** e.g. `uk-UA`, `ru-RU` (first supported language wins).
- **Query override:** `?lang=pl|uk|ru` (also accepts `ua` as Ukrainian).

Responses include a `content-language` header with the resolved locale.

## Smoke Checks

With server running (smoke scripts default to `http://127.0.0.1:3000`; override with `SMOKE_BASE_URL` if needed):

- Create/update smoke test user:
  - `npm run smoke:user`
- Run authenticated smoke checks (`login -> authorized endpoint -> validation contract`):
  - `npm run smoke:auth`
  - verifies: login, tasks stats access, permissions consistency (`/me` vs `/permissions`), payroll blocks on `/api/rozliczenia` and `/api/ekipy/rozliczenie` (`403` + `requestId`), validation contract (`400`)
- Run basic health smoke script (PowerShell; uses `127.0.0.1` to avoid Windows localhost/IPv6 quirks):
  - `npm run smoke:basic`
- Run PowerShell smoke with login-enabled checks:
  - `npm run smoke:basic:auth`
- Run full smoke sequence in one command:
  - `npm run smoke:full`

Smoke user credentials used by scripts:

- login: `smoke_admin`
- password: `Smoke123!`

## App Permissions Contract

Auth responses from:
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/auth/permissions`

include a `permissions` object used by frontend UI guards.

Example shape:

```json
{
  "policyVersion": 1,
  "taskScope": "all | branch | assigned_team_only",
  "canViewPayrollSettlements": false,
  "canManagePayrollSettlements": false,
  "canViewSettlementModule": false,
  "canCreateTasks": true,
  "canAssignTeams": true,
  "canManageTeams": true
}
```

Recommended frontend behavior:
- hide payout/settlement screens when `canViewSettlementModule` is `false`
- limit task list UI by `taskScope`
- hide create/assign/team management actions based on corresponding flags

Detailed UI integration checklist:
- `docs/frontend-permissions-checklist.md`
