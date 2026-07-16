# Arbor OS / Polska Flora

Production-track implementation using the supplied HTML prototypes as the UI source of truth.

## Run

```powershell
npm install
npm run db:seed
$env:ZADARMA_SECRET='change-this-long-random-secret'
$env:ARBOR_PORTAL_SECRET='change-this-long-random-secret'
npm run dev:full
```

Default URLs:

- Web host: http://127.0.0.1:5175/
- API: http://127.0.0.1:8790/api/health
- Mobile prototype: http://127.0.0.1:5175/#mobile
- Estimator cabinet: http://127.0.0.1:5175/#estimator
- Client portal: http://127.0.0.1:5175/#portal

## Current Runtime Architecture

- `public/prototypes/*.html` are the original delivered UI prototypes and remain the visual source of truth.
- `public/prototypes/prototype-api-bridge.js` connects those prototypes to the backend without redesigning screens.
- `server/index.mjs` exposes the role-gated REST API and Socket.IO realtime channels.
- `server/sqlite-db.mjs` persists demo data in normalized SQLite tables.
- `/api/dev/reset` is disabled by default; use `npm run db:seed` locally, or enable it only with `ARBOR_ENABLE_DEV_RESET=1` plus `ARBOR_DEV_RESET_SECRET`.
- User accounts support hashed password/PIN login. Demo users without a password hash can still use prototype login-only flow until a password is set.

## Connected Flows

- Desktop Arbor OS loads real orders, clients, crews and writes order status changes.
- CRM supports scoped client creation/update with duplicate-phone protection per branch.
- CRM supports scoped client CSV export/import with duplicate detection.
- Fleet supports scoped equipment reservations for orders with time-conflict protection.
- Warehouse supports scoped stock items and in/out/adjust movements with low-stock events.
- Reports expose scoped operational and financial KPIs for authorized roles.
- Arbor Mobile logs in as `brygadzista`, loads only assigned jobs, writes status/checklist/signature completion through `/api/sync/mutations`, and supports offline queued sync.
- Gabinet wyceniającego logs in as `wycena`, loads estimator orders, sends valuations to office through `POST /api/valuations`.
- Portal klienta uses a signed per-order token, then saves quote acceptance, online payment state, rating and messages only for that client/order.

## Integration Status

- Zadarma click-to-call is role-gated in CRM, and inbound webhooks require an HMAC signature from `ZADARMA_SECRET`.
- A valid inbound Zadarma webhook creates a CRM lead and a new order when the caller is unknown, then publishes the event to the branch realtime channel.
- AI call-analysis route returns deterministic analysis-shaped output and realtime event.
- Replace demo stubs with real provider calls only on the server; never expose secrets to browser code.

## Verification

```powershell
npm run build
npm run smoke:all
```

`smoke:all` expects the API to be running and resets the seed data before each stateful smoke check. For individual checks, run `npm run db:seed` before `smoke:core`, `smoke:tenant`, `smoke:realtime`, or `smoke:branch`.

Useful smoke checks:

- `POST /api/auth/login` with `kierownik`, `wycena`, `brygadzista`, `ksiegowa`
- `PATCH /api/users/:id/password` to require password/PIN for an account
- `GET /api/bootstrap` after each login to verify RBAC scoping
- `npm run smoke:tenant` to verify tenant isolation for CRM data, AI prompt history/test/rollback, workflow builder create/update/dry-run/live execution, module configs, billing, paused-account write gates, audit and sync events
- `npm run smoke:realtime` to verify Socket.IO auth, channel RBAC and branch order events
- `npm run smoke:branch` to verify manager, ROP, and delegated estimator branch access
- `POST /api/clients` and `PATCH /api/clients/:id` for scoped CRM client management
- `GET /api/clients/export.csv` and `POST /api/clients/import.csv` for CRM CSV workflows
- `GET/PATCH /api/softphone/availability` and `POST /api/softphone/incoming` for call queue routing, agent presence and AI overflow
- `POST /api/communications/:id/analyze` and `GET /api/ai/coaching` for prompt-driven AI call analysis and coaching scorecards
- `POST /api/equipment/:id/reservations` and `DELETE /api/equipment-reservations/:id` for fleet booking
- `GET /api/warehouse`, `POST /api/warehouse/items` and `POST /api/warehouse/movements` for stock control
- `GET /api/reports/overview` for scoped KPIs, revenue, margin, crews, overdue invoices and low stock
- `POST /api/sync/mutations` for mobile status/checklist updates
- `POST /api/valuations` for estimator quote submission
- `POST /api/documents/generate` for rendered order and employee documents from system fields
- `GET /api/documents/compliance`, `POST /api/document-requirements/:id/fulfill` and `GET /api/hr/compliance` for document requirements and HR expiry alerts
- `PATCH /api/portal` and `POST /api/portal/message` for client portal state
- `GET /api/orders/:id/portal-link` to generate a signed client portal token
- `POST /api/zadarma/webhook` with `x-zadarma-signature` for signed inbound-call intake
- `POST /api/softphone/incoming`, `/answer` and `/complete` for web softphone inbound call lifecycle with recording, transcript and AI analysis
