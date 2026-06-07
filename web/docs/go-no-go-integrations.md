# Go / No-Go Decision Sheet - Integrations Release

Date: __________
Environment: __________
Release owner: __________

## Mandatory Evidence

- [x] `npm run verify:integrations-release`
- [x] `npm test -w arbor-web -- src/pages/Integracje.test.js --testTimeout 20000`
- [x] `npm run build -w arbor-web`
- [ ] Smoke test completed (`web/docs/smoke-test-integrations-5min.md` or production smoke URL)
- [ ] Release checklist reviewed (`web/docs/release-checklist-integrations.md`)

## Scope Included

- Integrations dashboard with logs, stats, filters, pagination and sorting.
- Retry single + batch.
- Rate limit + cooldown UX.
- Denylist management, presets, history and rollback safeguards.
- CSV exports.
- Kommo diagnostics and owner acknowledgement.
- Branch setup checklist for telephony + Unified Inbox.

## Risk Review

- [ ] Retry endpoints protected by role checks.
- [ ] Channel-level retry permissions confirmed.
- [ ] Rollback max age restriction confirmed.
- [ ] Audit trail records actor, timestamp and request metadata where available.
- [ ] Denylist blocks retry for denied users/channels.

## Decision

- [ ] **GO**
- [ ] **NO-GO**

Decision owner: __________
Time: __________

## If NO-GO

- Primary blocker: ______________________
- Workaround available: Yes / No
- Next re-test window: __________________
