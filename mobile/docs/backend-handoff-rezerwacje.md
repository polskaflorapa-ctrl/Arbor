# Backend Handoff: Rezerwacje Sprzetu + Mobile Config

Ten dokument jest handoffem dla backendu i QA, aby utrzymac pelny flow mobile bez fallbacku
"server not found".

Automatyczne bramki kontraktu:

```bash
npm run verify:mobile-config
npm run verify:mobile-reservations-api
```

## 1) Endpointy wymagane przez mobile

### A. Mobile config

- `GET /api/mobile-config`
- `GET /api/config/mobile`
- Oba aliasy musza zwracac `200`.
- Naglowek: `X-Api-Version`.
- Body:

```json
{
  "version": "2.2.0-quotations",
  "apiVersion": "2.2.0-quotations",
  "appFlags": {
    "quotations": true,
    "quotationPanels": true,
    "quotationApprovals": true,
    "quotationPublicAcceptance": true
  },
  "oddzialFeatureOverrides": {},
  "generatedAt": "2026-06-20T00:00:00.000Z"
}
```

Mobile zapisuje `X-Api-Version` do diagnostyki, scala `appFlags` przez
`mergeAppRemoteFlags` i opcjonalne `oddzialFeatureOverrides` przez
`mergeRemoteOddzialFeatureOverrides`.

### B. Rezerwacje sprzetu

- `GET /api/flota/rezerwacje?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `POST /api/flota/rezerwacje`
- `PUT /api/flota/rezerwacje/:id/status`

## 2) Kontrakt request/response rezerwacji

### GET /flota/rezerwacje

- Query:
  - `from` (YYYY-MM-DD)
  - `to` (YYYY-MM-DD)
- Sukces: `200` + tablica `[]`.
- Element:
  - `id`, `sprzet_id`, `sprzet_nazwa`, `ekipa_id`, `ekipa_nazwa`, `data_od`, `data_do`, `caly_dzien`, `status`.

### POST /flota/rezerwacje

Body:

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

- Sukces: `201` + `{ "id": 101 }`.
- Brak `status`: `400`.
- Walidacja/konflikt: `400`/`409` + `{ "error": "..." }`.

### PUT /flota/rezerwacje/:id/status

Body:

```json
{ "status": "Wydane" }
```

- Sukces: `200`.
- Brak rekordu/uprawnien: `404`.
- Walidacja statusu: `400`.

### Dozwolone statusy

- `Zarezerwowane`
- `Wydane`
- `Zwrócone`
- `Anulowane`

## 3) Oczekiwane zachowanie auth

- Bez tokenu chronione endpointy rezerwacji daja `401` lub `403`.
- Z tokenem:
  - `auth/me` i `tasks/wszystkie` -> `200`
  - `mobile-config` -> `200`
  - `flota/rezerwacje` -> `200`

## 4) Szybki smoke test

Skrypt mobilny:

```bash
npm run smoke:api -w arbor-mobile
```

Z publicznym API:

```bash
API_URL=https://your-host/api AUTH_TOKEN=YOUR_TOKEN npm run smoke:api -w arbor-mobile
```

Skrypt raportuje statusy i latency dla:

- `auth/me`
- `tasks/wszystkie`
- `flota/rezerwacje` (GET)
- `flota/rezerwacje` (POST)
- `flota/rezerwacje/:id/status` (PUT)

## 5) QA checklist

- Login dziala, brak crashy.
- `api-diagnostyka`:
  - `auth/me` -> `200` z tokenem
  - `tasks/wszystkie` -> `200` z tokenem
  - `mobile-config` -> `200` i pokazuje `X-Api-Version`
  - `flota/rezerwacje` -> `200`
- `rezerwacje-sprzetu`:
  - tworzenie rezerwacji
  - zmiana statusu
  - konflikt na ten sam sprzet i dzien
  - filtrowanie konfliktow
  - skok do pierwszego konfliktu
