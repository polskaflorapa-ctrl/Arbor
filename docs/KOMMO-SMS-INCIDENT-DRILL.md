# Kommo/SMS incident drill

Cel: przed pilotem przejsc kontrolowany drill integracyjny bez masowych retry: Kommo `dead_letter`, retry pojedynczego zlecenia, SMS/Zadarma delivery fail i fallback przez raport ryzyk.

Ten drill nie wysyla realnych SMS ani webhookow sam z siebie. Opisuje probe na danych testowych i pilnuje, zeby repo mialo narzedzia do bezpiecznej reakcji.

## 1. Bramka lokalna

```powershell
cd C:\Users\paha1\arbor
npm run verify:kommo-sms-drill
npm run verify:incident-runbook
npm run check
```

## 2. Role i dostep

- Kommo retry wykonuje tylko rola backoffice: Prezes, Dyrektor, Administrator, Kierownik albo Dyspozytor zgodnie z backendowa polityka.
- Diagnostyka Kommo jest w `GET /api/tasks/kommo-sync/diagnostics`.
- Panel web: `Integracje -> Kommo task.sync` pokazuje `failed`, `dead_letter`, `retry_count`, `last_error`.
- SMS/Zadarma delivery jest w panelu Telefonia, `sms_history`, `sms_delivery_events` i raporcie ryzyk Kierownika.

## 3. Drill Kommo dead-letter

Warunki wejsciowe:

- Jest testowe zlecenie z numerem i klientem.
- Kommo webhook jest skonfigurowany w srodowisku testowym albo swiadomie zepsuty na czas proby.
- Nikt nie uruchamia retry batch.

Kroki:

1. Sprawdz diagnostyke:

```text
GET /api/tasks/kommo-sync/diagnostics?limit=30
GET /api/tasks/kommo-sync/diagnostics?status=dead_letter
```

2. W panelu Integracje potwierdz:
   - status `dead_letter` albo `failed`;
   - `retry_count`;
   - `last_http_status` albo `last_error`;
   - task id i klient.

3. Jesli status to `dead_letter`, pierwszy retry bez `force=true` ma zwrocic `409` i komunikat, ze wymagane jest sprawdzenie konfliktu:

```text
POST /api/tasks/:id/kommo-retry
```

4. Po potwierdzeniu mapowania/statusu i rozstrzygnieciu konfliktu wykonaj retry pojedynczego zlecenia:

```text
POST /api/tasks/:id/kommo-retry { "force": true }
```

5. Ponownie sprawdz diagnostyke i Kommo.

GO:

- `dead_letter` nie jest retriowany przypadkiem.
- Retry pojedynczego zlecenia zapisuje nowy status kolejki.
- `queue_errors` spada albo ma przypisanego wlasciciela.

NO-GO:

- Retry batch jest jedyna dostepna akcja.
- `force=true` jest uzyte bez wpisu decyzji.
- `last_error` nie pozwala odroznic mapowania, HTTP i bledu sieci.

## 4. Drill SMS/Zadarma delivery fail

Warunki wejsciowe:

- Zadarma webhook jest opisany w env runbooku.
- Jest zlecenie testowe z telefonem klienta.
- Test prowadzimy na numerze kontrolowanym albo z wylaczona realna wysylka.

Kroki:

1. Sprawdz konfiguracje:

```text
GET /api/sms/test
```

2. Sprawdz historie:

```text
GET /api/sms/historia?limit=30
```

3. Potwierdz, ze webhooki statusu sa ustawione:

```text
POST /api/sms/webhooks/zadarma
POST /api/sms/webhooks/zadarma/status
```

4. Dla bledu dostarczenia potwierdz:
   - `sms_history.delivery_error_code`;
   - `sms_history.provider_status`;
   - wpis w `sms_delivery_events`;
   - ryzyko `sms_delivery` w `/api/ops/kierownik-today`.

5. Jesli blad dotyczy jednego klienta, Kierownik uzywa akcji z raportu ryzyk:

```text
POST /api/ops/risk-report/actions { "action": "resend_zadarma_sms", "risk_type": "sms_delivery" }
POST /api/ops/risk-report/actions { "action": "queue_zadarma_call", "risk_type": "sms_delivery" }
```

GO:

- Blad SMS widac w Telefonii i raporcie ryzyk.
- Istnieje fallback: ponow SMS albo telefon Zadarma.
- Po fallbacku decyzja trafia do `ops_action_events`.

NO-GO:

- Delivery fail jest widoczny tylko w logach providera.
- Brak `PUBLIC_BASE_URL` albo webhook Zadarma prowadzi na localhost.
- SMS retry jest masowy bez wlasciciela incydentu.

## 5. Artefakty

Zapisz po drill:

- wynik `npm run verify:kommo-sms-drill`;
- screenshot panelu Integracje z kolejka Kommo;
- screenshot Telefonii albo historii SMS;
- task id, sms_history id, queue id;
- decyzje: retry bez force, retry z force, fallback SMS/telefon;
- follow-upy w backlogu.

## 6. Zamkniecie drill

```powershell
npm run verify:kommo-sms-drill
npm run verify:incident-runbook
npm run check
```

Drill jest zaliczony, gdy Kommo i SMS maja widoczna diagnostyke, pojedynczy retry jest kontrolowany, fallback ma wlasciciela, a wszystkie decyzje sa zapisane.
