# Checklist: rezerwacje sprzetu (backend + mobile)

Repozytorium zawiera aplikacje Expo/React Native oraz produkcyjny backend `arbor-os`.
Kontrakt zadan jest spiety z kodem w `mobile/utils/sprzet-rezerwacje.ts`,
ekranem `mobile/app/rezerwacje-sprzetu.tsx` oraz backendiem `os/src/routes/flota.js`.

Automatyczna bramka kontraktu:

```bash
npm run verify:mobile-reservations-api
```

---

## A. Backend - endpointy pod `API_URL` (prefix `/api`)

### 1. Model i baza

- [x] Tabela (lub kolekcja) z polami zgodnymi z mobile: `sprzet_id`, `ekipa_id`, `data_od`, `data_do`, `caly_dzien`, `status`, `oddzial_id`, znaczniki czasu, `id`.
- [x] Statusy dokladnie jak w aplikacji: `Zarezerwowane` | `Wydane` | `Zwrócone` | `Anulowane`.

### 2. `GET /flota/rezerwacje`

- [x] Query: `from`, `to` w formacie `YYYY-MM-DD`.
- [x] Odpowiedz: **tablica** JSON, zgodna z elastycznym parserem mobile.
- [x] Filtrowanie po oddziale / uprawnieniach uzytkownika z tokenu, spojnie z `/flota/sprzet`.
- [x] `401` / `403` gdy brak tokenu lub brak uprawnien.

### 3. `POST /flota/rezerwacje`

- [x] Body: `{ "sprzet_id", "ekipa_id", "data_od", "data_do", "caly_dzien", "status" }`; pole `status` jest obowiazkowe.
- [x] Odpowiedz sukcesu: `201` + JSON z `id` utworzonego rekordu.
- [x] Regula antykonfliktowa: ten sam sprzet i nakladajace sie aktywne daty zwracaja `409`.
- [x] Backend blokuje sprzet po terminie przegladu albo w naprawie/serwisie.

### 4. `PUT /flota/rezerwacje/:id/status`

- [x] Body: `{ "status" }` z jednym z dozwolonych statusow.
- [x] `404` gdy brak rekordu lub rekord poza zakresem oddzialu/uzytkownika.
- [x] `200` po udanej zmianie.

### 5. Deploy i weryfikacja

- [x] Kod i testy potwierdzaja, ze sonda `GET /flota/rezerwacje` nie jest tylko fallbackiem `404`.
- [x] Kontrakt jest objety `npm run verify:mobile-reservations-api` oraz `npm run verify:contracts`.
- [ ] Staging/live: w aplikacji **Diagnostyka API** sonda `GET /flota/rezerwacje` powinna zwracac `200` dla konta z wlaczonym modulem.

### 6. Zgodnosc z kolejka offline (mobile)

- [x] `POST /flota/rezerwacje` oraz `PUT /flota/rezerwacje/:id/status` akceptuja ksztalt JSON wysylany przez `mobile/utils/sprzet-rezerwacje.ts`.
- [x] Mobile rozroznia `404 notImplemented` od bledow walidacji/konfliktu i nie myli braku endpointu z konfliktem danych.
- [ ] Staging/live: scenariusz bez sieci -> zapis rezerwacji -> przywrocenie sieci -> synchronizacja po stronie API.

---

## B. Mobile - po wdrozeniu API

- [ ] Staging: konto z oddzialem majacym w macierzy `/rezerwacje-sprzetu` -> utworzenie rezerwacji -> zmiana statusu -> zmiana miesiaca i powrot; dane musza pochodzic z serwera.
- [ ] Obsluga bledow: walidacja/konflikt `400`/`409` pokazuje sensowny komunikat, zamiast zawsze przechodzic w tryb tylko lokalny.
- [ ] Kolejka offline: rekord zapisany offline pojawia sie po stronie API po synchronizacji.

---

## C. Kolejne pomysly produktowe

- [ ] Filtr "tylko moja ekipa" dla rol terenowych.
- [x] Skrot z **Misji dnia** lub **Harmonogramu**: rezerwacje na wybrany dzien.
- [x] Opcjonalne powiazanie ze **zleceniem** (`task_id`) w API i UI.

---

## Powiazane pliki w tym repo

| Plik | Rola |
|------|------|
| `os/src/routes/flota.js` | Produkcyjne endpointy `GET/POST/PUT/PATCH /flota/rezerwacje` |
| `os/tests/flota-rezerwacje.test.js` | Testy auth, scope, walidacji, konfliktow, `201` i statusow |
| `mobile/utils/sprzet-rezerwacje.ts` | Klient API + magazyn lokalny |
| `mobile/app/rezerwacje-sprzetu.tsx` | Ekran uzytkownika |
| `mobile/app/api-diagnostyka.tsx` | Sonda `GET /flota/rezerwacje` |
| `mobile/config/oddzial-feature-matrix.json` | Dostep do modulu po oddziale (`/rezerwacje-sprzetu`) |
