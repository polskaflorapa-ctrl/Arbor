# Smoke API CMR (backend, ok. 5 min)

Moduł **CMR został usunięty z UI** aplikacji web (`#/cmr` przekierowuje na CRM). Endpointy `GET/POST /api/cmr` nadal mogą być w użyciu przy integracjach — ten dokument dotyczy wyłącznie **weryfikacji API**.

Użyj przed releasem razem z [cmr-crm-jesien-checklist.md](./cmr-crm-jesien-checklist.md).

## Automatycznie (30 s)

W katalogu `web` przy **włączonym API** (np. port 3001):

```bash
node ./scripts/smoke-cmr.cjs
```

Inny port bazy API:

```bash
set ARBOR_SMOKE_API_BASE=http://127.0.0.1:3003/api
node ./scripts/smoke-cmr.cjs
```

Skrypt sprawdza m.in.: `GET /api/health`, logowanie, `GET /api/tasks/stats`, `GET /api/cmr`.

**Payload Kommo (CRM, bez wysyłki POST):** `npm run smoke:kommo:crm` — `GET …/tasks/:id/kommo-payload` oraz `GET …/klienci/:id/kommo-payload`.

## Wynik

- [ ] **GO** — skrypt + ewentualne ręczne wywołania API OK  
- [ ] **NO-GO** — zatrzymaj release, dołącz log z terminala
