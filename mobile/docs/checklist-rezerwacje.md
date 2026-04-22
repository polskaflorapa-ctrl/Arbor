# Checklist: rezerwacje sprzętu (backend + mobile)

Repozytorium zawiera aplikację **Expo/React Native**; backend jest osobną usługą (np. Render — `arbor-os`). Kontrakt żądań jest spójny z `config/flota-rezerwacje-api.example.json` oraz z kodem w `utils/sprzet-rezerwacje.ts` i ekranie `app/rezerwacje-sprzetu.tsx`.

---

## A. Backend — endpointy pod `API_URL` (prefix `/api`)

### 1. Model i baza

- [ ] Tabela (lub kolekcja) z polami zgodnymi z mobile: `sprzet_id`, `ekipa_id`, `data_od`, `data_do`, `caly_dzien`, `status`, ewentualnie `oddzial_id` (jeśli izolacja jak przy `/flota/sprzet`), znaczniki czasu, `id`.
- [ ] Statusy dokładnie jak w aplikacji: `Zarezerwowane` | `Wydane` | `Zwrócone` | `Anulowane` (albo enum z mapowaniem — jedna strona prawdy w kontrakcie).

### 2. `GET /flota/rezerwacje`

- [ ] Query: `from`, `to` w formacie `YYYY-MM-DD` (zgodnie z wywołaniami z mobile i sondą w diagnostyce API).
- [ ] Odpowiedź: **tablica** JSON **lub** obiekt `{ "rezerwacje": [...] }` — mobile obsługuje oba warianty.
- [ ] Filtrowanie po oddziale / uprawnieniach użytkownika z tokenu (spójnie z `/flota/sprzet` i `/ekipy`).
- [ ] `401` / `403` gdy brak tokenu lub brak uprawnień.

### 3. `POST /flota/rezerwacje`

- [ ] Body: `{ "sprzet_id", "ekipa_id", "data_od", "data_do", "caly_dzien", "status" }` — pole **status** obowiązkowe (przy braku: `400` z czytelnym polem `error` lub podobnym).
- [ ] Odpowiedź sukcesu: `201` + JSON z **`id`** utworzonego rekordu (mobile odczytuje `id`).
- [ ] Opcjonalnie: reguła antykonfliktowa (ten sam sprzęt, nakładające się daty) → `409` lub `400` z komunikatem.

### 4. `PUT /flota/rezerwacje/:id/status`

- [ ] Body: `{ "status" }` z jednym z dozwolonych statusów.
- [ ] `404` gdy brak rekordu lub rekord poza zakresem oddziału/użytkownika.
- [ ] `200` po udanej zmianie.

### 5. Deploy i weryfikacja

- [ ] Wdrożenie na środowisko testowe → w aplikacji: **Diagnostyka API** — sonda `GET /flota/rezerwacje` powinna zwracać **200** (nie wyłącznie `404`).
- [ ] Jeśli używacie wersjonowania API (`/mobile-config`, nagłówki itd.) — podbić wersję i ewentualnie `EXPO_PUBLIC_EXPECTED_API_VERSION` w buildach mobilnych.

### 6. Zgodność z kolejką offline (mobile)

- [ ] `POST /flota/rezerwacje` oraz `PUT /flota/rezerwacje/:id/status` akceptują ten sam kształt JSON, jaki trafia z `utils/offline-queue.ts` (bez dodatkowych pól wymaganych tylko z innych klientów).
- [ ] Opcjonalnie: idempotencja powtórzonego `POST` po reconnect (unikalny klucz biznesowy lub świadome dopuszczenie duplikatów).

---

## B. Mobile — po wdrożeniu API

- [ ] **Staging:** konto z oddziałem mającym w macierzy `/rezerwacje-sprzetu` → utworzenie rezerwacji → zmiana statusu → zmiana miesiąca i powrót — dane muszą pochodzić z serwera (nie tylko z pamięci lokalnej).
- [ ] **Obsługa błędów:** rozróżnienie „endpoint nie istnieje (`404`)" od „walidacja / konflikt (`400`/`409`)" — użytkownik powinien widzieć sensowny komunikat zamiast zawsze wpadać w tryb wyłącznie lokalny.
- [ ] **Kolejka offline:** scenariusz bez sieci → zapis rezerwacji → przywrócenie sieci i synchronizacja (np. z profilu / diagnostyki) → rekord pojawia się po stronie API.

---

## C. Kolejne pomysły produktowe (priorytet wg potrzeb)

- [ ] Filtr „tylko moja ekipa” dla ról terenowych.
- [ ] Skrót z **Misji dnia** lub **Harmonogramu**: rezerwacje na wybrany dzień (np. jutro).
- [ ] Opcjonalne powiązanie ze **zleceniem** (`zlecenie_id`) — po ustaleniu procesu i migracji API.

---

## Powiązane pliki w tym repo

| Plik | Rola |
|------|------|
| `config/flota-rezerwacje-api.example.json` | Przykładowy kontrakt REST |
| `utils/sprzet-rezerwacje.ts` | Klient API + magazyn lokalny |
| `app/rezerwacje-sprzetu.tsx` | Ekran użytkownika |
| `app/api-diagnostyka.tsx` | Sonda `GET /flota/rezerwacje` (bieżący miesiąc) |
| `config/oddzial-feature-matrix.json` | Dostęp do modułu po oddziale (`/rezerwacje-sprzetu`) |
