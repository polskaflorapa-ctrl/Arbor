# Własna instancja Kommo + ARBOR

Kommo to **osobna** aplikacja (CRM). ARBOR nie loguje się do Kommo po OAuth w tym repozytorium — zamiast tego:

1. **Przycisk „Otwórz Kommo”** na `#/crm` — tylko link do Twojej subdomeny.
2. **Wysyłka danych** — backend robi `POST` z JSON na adres, który **Ty** ustawiasz. Domyślnie wszystkie typy (`cmr.sync`, `task.sync`, `klient.sync`) idą na **`KOMMO_WEBHOOK_URL`**. Możesz rozdzielić scenariusze: ustaw **`KOMMO_CRM_WEBHOOK_URL`** — wtedy **zlecenia** i **klienci** trafiają tam, a **CMR** nadal na `KOMMO_WEBHOOK_URL`. Najczęściej to **pośrednik** (Make, n8n), który mapuje JSON na [API Kommo v4](https://www.kommo.com/developers/content/crm_platform/leads-api/).

### Endpointy (CRM — bez CMR)

| Akcja | Metoda | Ścieżka API (sesja wymagana) |
| ----- | ------ | ---------------------------- |
| Podgląd JSON zlecenia | `GET` | `/api/tasks/:id/kommo-payload` |
| Wyślij zlecenie do webhooka | `POST` | `/api/tasks/:id/kommo-push` |
| Podgląd JSON klienta | `GET` | `/api/klienci/:id/kommo-payload` |
| Wyślij klienta do webhooka | `POST` | `/api/klienci/:id/kommo-push` |

**arbor-os** (backend Node + Postgres): te same ścieżki pod `/api/tasks/…` i `/api/klienci/…`, ten sam kształt JSON i zmienne środowiskowe co `web/server` (patrz `web/.env.example`). Migracja kolumn `kommo_last_sync_*`: `os/migrate.sql` oraz pierwsze wywołanie tras klientów (`klienci.js`).

W UI: **szczegóły zlecenia** oraz **Klienci → wybrany rekord** — sekcja „Kommo (CRM)”.

**Smoke (CLI, w katalogu `web`):** `npm run smoke:kommo:crm` — sprawdza `GET …/kommo-payload` dla pierwszego zlecenia i pierwszego klienta (bez `POST`, chyba że `ARBOR_KOMMO_SMOKE_PUSH=1`).

**Rozróżnienie zdarzeń w JSON:** `event` = `task.sync` | `klient.sync` | `cmr.sync` — pośrednik może rozgałęziać scenariusze.

**Pola niestandardowe (CRM):** opcjonalnie `KOMMO_CF_PHONE_ID` (telefon), `KOMMO_CF_KLIENT_RECORD_ID` (id rekordu klienta w ARBOR). Dla zlecenia nadal możesz użyć m.in. `KOMMO_CF_ORDER_ID` (tu: **id zlecenia**), `KOMMO_CF_BRANCH_ID`, `KOMMO_CF_STATUS_ID`, `KOMMO_CF_LOAD_DATE_ID` (data planowana), `KOMMO_CF_GOODS_SUMMARY_ID` (tu: typ usługi). Tagi CRM domyślnie: `KOMMO_CRM_TAGS` (domyślnie `Arbor,CRM`).

---

## Krok 1 — konto i link w aplikacji

1. Załóż / zaloguj się do Kommo: dostaniesz adres w stylu `https://twoja-firma.kommo.com`.
2. W środowisku **frontu** (build / hosting) ustaw:

   ```env
   REACT_APP_KOMMO_APP_URL=https://twoja-firma.kommo.com
   ```

3. Przebuduj front (`npm run build`). Na `#/crm` pojawi się przycisk otwierający **Twoją** Kommo.

---

## Krok 2 — skąd wziąć ID pól i lejka w Kommo

W Kommo potrzebujesz numerycznych ID (nie nazw):

| Zmienna w `web/server` | Znaczenie |
| ---------------------- | --------- |
| `KOMMO_PIPELINE_ID` | ID lejka (pipeline), do którego trafia lead |
| `KOMMO_STATUS_ID` | ID etapu (status) w tym lejku |
| `KOMMO_RESPONSIBLE_USER_ID` | (opcjonalnie) ID użytkownika Kommo odpowiedzialnego |
| `KOMMO_CF_*` | ID **pól niestandardowych** leada (np. numer CMR, nr zlecenia) |

**Jak znaleźć ID w praktyce**

- W panelu Kommo: **Ustawienia → Leady → Pipelines** — w URL przeglądarki często widać `pipeline_id=…`.
- Pola niestandardowe: **Ustawienia → Leady → Custom fields** albo przez API `GET /api/v4/leads/custom_fields` z tokenem (w dokumentacji Kommo jest pełny opis).

Skopiuj wartości do **serwera** ARBOR (nie do frontu), np. plik `.env` obok `web/server` lub zmienne na hostingu:

```env
KOMMO_PIPELINE_ID=1234567
KOMMO_STATUS_ID=2345678
KOMMO_CF_CMR_NUMBER_ID=111111
# … reszta z web/.env.example
```

Te ID są wkładane do JSON-a wysyłanego na webhook (sekcja `kommo.lead`).

---

## Krok 3 — adres webhooka (`KOMMO_WEBHOOK_URL`)

Backend wywołuje:

```http
POST {KOMMO_WEBHOOK_URL}
Content-Type: application/json
```

Ciało żądania dla CMR (jeśli używasz API list przewozowych): `GET /api/cmr/:id/kommo-payload` z sesją. W interfejsie webowym moduł CMR został wyłączony — integracja może zostać po stronie API / zewnętrznego narzędzia.

**Dwie typowe ścieżki**

### A) Pośrednik (zalecane na start)

1. W **Make** / **n8n** / **Zapier** utwórz scenariusz: trigger **Webhook** (metoda POST, raw JSON).
2. Wklej URL webhooka z tego narzędzia jako `KOMMO_WEBHOOK_URL`.
3. W scenariuszu: mapuj `kommo.lead` + `cmr` na moduł **Kommo — Create lead** (REST API) albo na inny kanał.

Dzięki temu nie musisz zgadywać, czy natywny webhook Kommo przyjmie dokładnie ten JSON — transformacja jest po Twojej stronie.

### B) Bezpośrednio do Kommo

Możliwe tylko wtedy, gdy **konkretny** URL integracji w Kommo (np. Digital Pipeline / własny skrypt na stronie Kommo) akceptuje ten sam kształt JSON co `buildKommoCmrPayload` w `web/server/routes/api.js`. W razie błędów 4xx/5xx sprawdź odpowiedź API / logi serwera.

---

## Krok 4 — opcjonalna ochrona webhooka

Jeśli Twój endpoint wymaga tajnego nagłówka:

```env
KOMMO_WEBHOOK_SECRET_HEADER=X-Webhook-Secret
KOMMO_WEBHOOK_SECRET=losowy_dlugi_ciag
```

ARBOR dołączy ten nagłówek do każdego `POST`.

---

## Krok 5 — test

1. Ustaw wszystkie zmienne na **serwerze** API (`web/server`), zrestartuj proces.
2. W ARBOR: CMR → wybierz rekord → **Wyślij do Kommo** (lub równoważny przycisk).
3. Sprawdź w Kommo, czy lead się pojawił; przy błędzie — treść błędu w ARBOR + log pośrednika.

---

## Skrót zmiennych (serwer)

Pełna lista w pliku `web/.env.example` (sekcja Kommo). Alias: `KOMMO_CMR_WEBHOOK_URL` działa tak samo jak `KOMMO_WEBHOOK_URL`.

---

## Co dalej (poza tym dokumentem)

- **Scenariusz Make.com** (router po polu `event`): [kommo-make-scenariusz.md](./kommo-make-scenariusz.md).
- **Dwukierunkowa synchronizacja / OAuth Kommo** — nie ma w tym repo; wymagałoby osobnej integracji z API Kommo.
