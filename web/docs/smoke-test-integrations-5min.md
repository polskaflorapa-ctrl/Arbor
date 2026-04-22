# Smoke Test (5 min) - Integrations

Use this right before release for a fast go/no-go signal.

## Status sesji (automatycznie)

**Data:** 2026-04-21

- [x] `npm run verify` — **OK** (build + testy)
- [x] `npm run build` — **OK**
- [x] `npm test -- --watchAll=false` — **OK** (12 testów, m.in. integracyjny widok Integracji + redirect bez sesji)
- [x] `git push origin main` — **OK** (`main` = `origin/main`)

Dalej: **musisz uruchomić backend + frontend** i odhaczyć punkty ręcznie.

## Preconditions

- [ ] App is running and you can log in as management role.
- [ ] `#/integracje` route is available.

## 60-second critical checks

- [ ] Open `#/integracje` and confirm page loads (no crash).
- [ ] Stats cards render values.
- [ ] Logs table renders at least header + pagination controls.
- [ ] Auto-refresh toggle can be switched on/off.

## Retry path checks (2 minutes)

- [ ] Trigger single `Retry` on one log.
- [ ] Confirm new retry row appears in logs or audit.
- [ ] Trigger `Retry batch` on 2+ selected rows.
- [ ] Confirm success message and audit update.

## Security checks (1 minute)

- [ ] Confirm cooldown appears after aggressive retries (or force via rate limit).
- [ ] Confirm retry button becomes disabled during cooldown.
- [ ] Confirm denylist badges/summary render in UI.

## Denylist safety checks (1 minute)

- [ ] Apply one preset (e.g. block SMS globally).
- [ ] Verify denylist summary changes.
- [ ] Verify denylist history gets new row.
- [ ] Rollback test with double-confirm click.

## Result

- [ ] **GO** (all checks green)
- [ ] **NO-GO** (any critical check failed)

If NO-GO: attach screenshot + failing step + timestamp and stop release.

