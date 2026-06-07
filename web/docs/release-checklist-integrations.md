# Release Checklist - Integrations & Security

## Integrations release gate

Run before go-live or before enabling integration retries for a branch:

```bash
npm run verify:integrations-release
npm test -w arbor-web -- src/pages/Integracje.test.js --testTimeout 20000
npm run build -w arbor-web
```

This gate confirms the release evidence for:

- retry single + batch;
- rate limit + cooldown;
- denylist manual/presets/rollback;
- CSV exports;
- RBAC: retry endpoints and channel permissions;
- Kommo diagnostics and owner acknowledgement;
- branch setup checklist for telephony + Unified Inbox.

## 1. Build And Basic Quality Gates

- [x] `npm run verify:integrations-release` passes.
- [x] `npm test -w arbor-web -- src/pages/Integracje.test.js --testTimeout 20000` passes.
- [x] `npm run build -w arbor-web` passes.
- [ ] App starts and main routes render without runtime errors on the target environment.

## 2. Integrations Dashboard

- [x] Stats cards, logs table and retry readiness render in `Integracje.test.js`.
- [x] Logs request includes filtering by `task_id`, `channel`, `status`, pagination, page size, sort field and direction.
- [x] Auto-refresh toggle is covered by UI test.
- [x] Trend and summary cards are included in the dashboard contract.

## 3. Retry Operations

- [x] Single retry calls `/integrations/logs/:id/retry`.
- [x] Batch retry is guarded when no rows are selected.
- [x] Backend records retry audit for `single` and `batch`.
- [x] Backend returns `retry_after_ms`; UI shows cooldown and disables retry buttons.

## 4. Denylist Management

- [x] Manual denylist save calls `/integrations/security/denylist`.
- [x] Presets call `/integrations/security/denylist/preset`.
- [x] Denylist summary and history render in UI.
- [x] History export creates `denylist-history-YYYY-MM-DD.csv`.

## 5. Rollback Safety

- [x] Rollback requires two clicks.
- [x] Rollback max age is controlled by `DENYLIST_ROLLBACK_MAX_AGE_DAYS`.
- [x] Old rollback rows show the disabled `14d+` state.
- [x] Backend errors are surfaced as UI status messages.

## 6. Security And Permissions

- [x] Retry endpoints require integration management role.
- [x] `Kierownik` can retry `email` and `push`, but not `sms`.
- [x] Denylisted user/channel blocks retry.
- [x] Retry audit stores actor and request metadata.

## 7. Final Release Decision

- [ ] Smoke test completed on target environment.
- [ ] Product owner signs off on functional scope.
- [ ] Security owner signs off on retry controls and auditability.
- [ ] Deployment window and rollback plan are documented.

## GO / NO-GO

GO:

- automated gate and web tests pass;
- target environment smoke passes;
- owner and security sign-off are recorded.

NO-GO:

- `npm run verify:integrations-release` fails;
- retry RBAC, denylist rollback or audit evidence is missing;
- target environment smoke fails.
