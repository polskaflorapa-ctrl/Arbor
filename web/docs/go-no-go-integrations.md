# Go / No-Go Decision Sheet - Integrations Release

Date: __________  
Environment: __________  
Release owner: __________

## Status sesji (automatycznie — 2026-04-21)

- [x] `npm run verify` — OK lokalnie (build + 12 testów Jest, w tym `Integracje.test.js`)
- [x] Lint clean (IDE) dla: `Integracje.js`, `ZlecenieDetail.js`, `fullStack.js`
- [x] GitHub Actions: workflow `.github/workflows/ci.yml` (`verify` na `ubuntu-latest`, gałąź `main`)
- [x] Remote sync: `git push origin main` — `main` zsynchronizowany z `origin/main`

**Uwaga:** pełne **GO** wymaga jeszcze smoke testu w przeglądarce + podpisów właścicieli (poniżej).

## Scope included

- Integrations dashboard (global logs, filters, pagination, sorting)
- Retry single + batch
- Rate limit + cooldown UX
- Denylist management + presets
- Denylist history + rollback (with safeguards)
- CSV exports (logs + denylist history)

## Mandatory evidence

- [x] `npm run verify` (build + unit tests)
- [x] Lint clean for touched files
- [x] Changes pushed to `origin/main` (feature + docs)
- [ ] Smoke test completed (`docs/smoke-test-integrations-5min.md`)
- [ ] Release checklist reviewed (`docs/release-checklist-integrations.md`)

## Risk review

- [ ] Retry endpoints protected by role checks
- [ ] Channel-level retry permissions confirmed
- [ ] Rollback max age restriction confirmed
- [ ] Audit trail records actor + timestamp (+ IP where available)

## Decision

- [ ] **GO**
- [ ] **NO-GO**

Decision owner: __________  
Time: __________

## If NO-GO

- Primary blocker: ______________________
- Workaround available: Yes / No
- Next re-test window: __________________

