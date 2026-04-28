# Make.com — jeden webhook, trzy typy zdarzeń (ARBOR → Kommo)

ARBOR wysyła na webhook JSON z polem **`event`**: `task.sync` (zlecenie), `klient.sync` (klient CRM), `cmr.sync` (lista CMR, tylko `web/server` gdy włączone CMR). Ten sam kształt jest używany przez **`web/server`** i **`arbor-os`**.

## 1. Trigger: Custom webhook

1. W Make utwórz nowy scenariusz, moduł **Webhooks → Custom webhook**.
2. Utwórz webhook (metoda **POST**, typ treści sugerowany: **JSON** / Raw).
3. Skopiuj adres URL i wstaw go w ARBOR:
   - **Tylko CRM** (zlecenia + klienci): `KOMMO_CRM_WEBHOOK_URL` — wtedy CMR nadal może iść na `KOMMO_WEBHOOK_URL` z osobnym scenariuszem.
   - **Wszystko w jednym scenariuszu:** jeden URL w `KOMMO_WEBHOOK_URL` (i opcjonalnie ten sam w `KOMMO_CRM_WEBHOOK_URL`, jeśli nie rozdzielasz).

## 2. Router po `event`

Po triggerze dodaj moduł **Router** (lub **Flow control → Router**) z trzema ścieżkami:

| Ścieżka | Warunek (przykład w Make) | Dalsze kroki |
| ------- | ------------------------- | ------------ |
| Zlecenie | `event` równa się `task.sync` | Mapuj `kommo.lead` + ewentualnie `task` → moduł **Kommo** (HTTP „Create a lead” / oficjalny connector) albo **HTTP** do `POST https://…kommo.com/api/v4/leads` z tokenem. |
| Klient | `event` równa się `klient.sync` | Jak wyżej; w treści masz `klient.*` i ten sam `kommo.lead`. |
| CMR | `event` równa się `cmr.sync` | Tylko gdy ARBOR wysyła CMR na ten sam URL; mapuj `cmr` + `kommo.lead`. |

W polach Make często adresujesz **dane z triggera** jako `{{1.event}}` lub `{{body.event}}` — zależnie od tego, jak Make spłaszcza payload (sprawdź w „Run once” podgląd danych).

## 3. Uwagi praktyczne

- **Duplikaty leadów:** w JSON jest `kommo.lead.external_id` (`task:123`, `klient:456`, …). W Make przed utworzeniem leada możesz wywołać wyszukiwanie po `external_id` (API Kommo) i zaktualizować istniejący rekord zamiast tworzyć drugi.
- **Nagłówek tajny:** jeśli ustawisz `KOMMO_WEBHOOK_SECRET_HEADER` + `KOMMO_WEBHOOK_SECRET`, w triggerze Make możesz włączyć weryfikację nagłówka (zależnie od typu webhooka).
- **Test bez Kommo:** uruchom scenariusz „Run once”, w ARBOR użyj **Podgląd payloadu** (`GET …/kommo-payload`), a potem opcjonalnie **Wyślij** (`POST …/kommo-push`).

## 4. Minimalny przepływ (jedna gałąź)

Jeśli na start chcesz tylko **zlecenia**: jeden webhook w `KOMMO_CRM_WEBHOOK_URL`, router z jedną aktywną ścieżką `task.sync`, resztę zdarzeń możesz ignorować lub zakończyć modułem „No operation”.
