# Release Checklist - Integrations & Security

## Status sesji (automatycznie zweryfikowane)

**Data:** 2026-04-21  
**Środowisko:** lokalne (Cursor / dev)

- [x] `npm run verify` (build + test) — **OK** (albo osobno: `npm run build`, `npm test -- --watchAll=false`)
- [x] `npm run build` — **OK** (`Compiled successfully`)
- [x] Lint (IDE) dla plików krytycznych — **OK** (brak diagnostyk):
  - `src/pages/Integracje.js`
  - `src/pages/ZlecenieDetail.js`
  - `server/routes/fullStack.js`
- [x] `npm test -- --watchAll=false` — **OK** (3 suite, 12 testów; w tym `src/pages/Integracje.test.js` — mock `api` + sesja + redirect bez JWT)
- [x] `git push origin main` — **OK** (`main` zsynchronizowany z `origin/main`)
- [x] GitHub Actions — `.github/workflows/ci.yml` uruchamia `npm run verify` na `push` / `pull_request` do `main`

Pozostałe punkki poniżej wymagają **ręcznego klikania w przeglądarce** (nie da się ich uczciwie odhaczyć z poziomu CI bez uruchomionego backendu + logowania).

---

## 1) Build and basic quality gates

- [x] `npm run build` passes with no errors.
- [x] Lint diagnostics are clean for:
  - `src/pages/Integracje.js`
  - `src/pages/ZlecenieDetail.js`
  - `server/routes/fullStack.js`
- [ ] App starts and main routes render without runtime errors.

## 2) Integrations dashboard (global)

- [ ] Open `#/integracje` and verify stats cards load.
- [ ] Verify logs table supports:
  - [ ] filtering by `task_id`
  - [ ] filtering by `channel`
  - [ ] filtering by `status`
  - [ ] pagination and page size
  - [ ] sort field and direction
- [ ] Verify auto-refresh toggle works (10s polling on/off).
- [ ] Verify trend chart renders for available logs.

## 3) Retry operations

- [ ] Single retry works for eligible row.
- [ ] Batch retry works for selected rows.
- [ ] Rate limit triggers after repeated retries and returns cooldown.
- [ ] UI shows cooldown timer and disables retry buttons during cooldown.
- [ ] Retry audit table records:
  - [ ] mode (`single`/`batch`)
  - [ ] actor
  - [ ] source and created log IDs
  - [ ] IP

## 4) Denylist management

- [ ] Manual denylist save works for channels and users.
- [ ] Presets work:
  - [ ] block SMS globally
  - [ ] allow all channels
  - [ ] clear all
- [ ] Denylist summary updates in UI after save.
- [ ] Denylist history is appended for:
  - [ ] manual updates
  - [ ] presets
  - [ ] rollback actions

## 5) Rollback safety

- [ ] Rollback requires two-step confirmation.
- [ ] Diff column correctly shows `prev -> next` changes.
- [ ] Rollback is blocked for old entries (>14 days).
- [ ] Disabled rollback rows show "niedostępny (14d+)" badge.
- [ ] Backend error reason is surfaced in UI toast.

## 6) Security and permissions

- [ ] Retry endpoints deny non-management roles (`403`).
- [ ] Channel-level permissions are enforced:
  - [ ] `Kierownik` cannot retry `sms`
  - [ ] `Kierownik` can retry `email` and `push`
- [ ] Denylist blocks retry when user/channel is denylisted.

## 7) Export and auditability

- [ ] Global logs export CSV works from backend endpoint.
- [ ] Denylist history export CSV works from UI.
- [ ] Export respects active filters.

## 8) Final release decision

- [ ] Product owner signs off on functional scope.
- [ ] Security owner signs off on retry controls and auditability.
- [ ] Deployment window and rollback plan are documented.
- [ ] Go-live approved.

