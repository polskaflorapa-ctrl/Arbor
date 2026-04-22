# Backend Handoff: Rezerwacje Sprzetu + Mobile Config

Ten dokument jest gotowym handoffem dla backendu i QA, aby domknac bledy "server not found" i aktywowac pelny flow mobile.

## 1) Endpointy wymagane przez mobile

### A. Mobile config (opcjonalnie, ale zalecane)
- `GET /api/mobile-config`
- Aktualnie appka traktuje `404` jako "brak wdrozenia" (dziala fallback), ale endpoint powinien docelowo zwracac konfiguracje.

### B. Rezerwacje sprzetu (wymagane)
- `GET /api/flota/rezerwacje?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `POST /api/flota/rezerwacje`
- `PUT /api/flota/rezerwacje/:id/status`

Kontrakt przykladowy: `config/flota-rezerwacje-api.example.json`

## 2) Kontrakt request/response (minimum)

### GET /flota/rezerwacje
- Query:
  - `from` (YYYY-MM-DD)
  - `to` (YYYY-MM-DD)
- Odpowiedz:
  - tablica `[]` albo obiekt `{ "rezerwacje": [] }`
- Element:
  - `id`, `sprzet_id`, `sprzet_nazwa`, `ekipa_id`, `ekipa_nazwa`, `data_od`, `data_do`, `caly_dzien`, `status`

### POST /flota/rezerwacje
- Body:
```json
{
  "sprzet_id": 12,
  "ekipa_id": 3,
  "data_od": "2026-04-29",
  "data_do": "2026-04-29",
  "caly_dzien": true,
  "status": "Zarezerwowane"
}
```
- Sukces: `201` + `{ "id": 101 }`
- Walidacja/konflikt: `400`/`409` + `{ "error": "..." }`

### PUT /flota/rezerwacje/:id/status
- Body:
```json
{ "status": "Wydane" }
```
- Sukces: `200`
- Brak rekordu/uprawnien: `404`
- Walidacja statusu: `400`

### Dozwolone statusy
- `Zarezerwowane`
- `Wydane`
- `Zwrócone`
- `Anulowane`

## 3) Oczekiwane zachowanie auth

- Bez tokenu:
  - endpointy chronione powinny dawac `401` lub `403`
- Z tokenem:
  - `auth/me` i `tasks/wszystkie` -> `200`
  - `flota/rezerwacje` -> `200` po wdrozeniu

## 4) Szybki smoke test (automatyczny)

Dodany skrypt:
- `scripts/smoke-api-rezerwacje.cjs`
- npm script: `npm run smoke:api`

Przyklady:

```bash
npm run smoke:api
```

```bash
API_URL=https://your-host/api AUTH_TOKEN=YOUR_TOKEN npm run smoke:api
```

Skrypt raportuje statusy i latency dla:
- `auth/me`
- `tasks/wszystkie`
- `flota/rezerwacje` (GET)
- `flota/rezerwacje` (POST)
- `flota/rezerwacje/:id/status` (PUT)

## 5) QA checklist

- Login dziala, brak crashy
- `api-diagnostyka`:
  - `auth/me` -> 200 (z tokenem)
  - `tasks/wszystkie` -> 200 (z tokenem)
  - `mobile-config` -> 200 (po wdrozeniu) lub 404 (przed wdrozeniem)
  - `flota/rezerwacje` -> 200 (po wdrozeniu)
- `rezerwacje-sprzetu`:
  - tworzenie rezerwacji
  - zmiana statusu
  - konflikt na ten sam sprzet i dzien
  - filtrowanie konfliktow
  - skok do pierwszego konfliktu

