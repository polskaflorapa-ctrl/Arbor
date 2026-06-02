# Kommo idempotency, retry and dead-letter contract

Cel: zamknac EPIC 8.3 tak, zeby dwukierunkowy sync Kommo mial mierzalny kontrakt operacyjny: outbound ARBOR -> Kommo nie gubi `task.sync`, inbound Kommo -> ARBOR nie dubluje eventow, a diagnostyka pokazuje problemy przed pilotem.

## Zakres

- Outbound ARBOR -> Kommo: `task.sync` zapisuje nieudana wysylke do `task_kommo_sync_queue`.
- Retry: kolejka trzyma `retry_count`, `next_retry_at`, `last_http_status`, `last_error`, `payload_json` i `actor_json`.
- Dead-letter: po limicie prob wpis ma status `dead_letter`; reczne ponowienie przez `/api/tasks/:id/kommo-retry` wymaga `force=true`.
- Idempotencja outbound: jeden aktywny wpis jest trzymany przez `UNIQUE (task_id, event)` dla `task.sync`.
- Inbound Kommo -> ARBOR: webhook `/api/webhooks/kommo/task-sync` i alias `/api/webhooks/kommo/task-update` zapisuje event w `task_kommo_inbound_events`.
- Idempotencja inbound: `event_key` pochodzi z jawnego identyfikatora eventu albo stabilnego hash payloadu; duplikat zwraca `duplicate: true` i nie aktualizuje zlecenia.
- Konflikty inbound: proba zmiany zamknietego zlecenia zapisuje `status = 'conflict'`, ustawia `kommo_last_sync_status = 'conflict'` i zwraca 409.
- Diagnostyka: `/api/tasks/kommo-sync/diagnostics` pokazuje outbound queue, `dead_letter`, retry metadata, inbound events i licznik `inbound_conflicts`.

## Kontrakt outbound

1. `syncTaskToKommo` buduje payload `task.sync` i probuje wyslac webhook.
2. Blad HTTP lub blad transportu wywoluje `recordKommoTaskSyncFailure`.
3. `recordKommoTaskSyncFailure` podbija `retry_count`, wylicza `next_retry_at` przez backoff i zapisuje snapshot payloadu.
4. Gdy `retry_count >= maxRetries`, status przechodzi na `dead_letter`.
5. Sukces wywoluje `markKommoTaskSyncSuccess`, ktory ustawia `sent`, zeruje blad i zapisuje `sent_at`.
6. `/api/tasks/:id/kommo-retry` blokuje retry wpisu `dead_letter`, jesli request nie ma `force=true`.

## Kontrakt inbound

1. Webhook sprawdza sekret Kommo i tworzy tabele inbound, jesli ich brakuje.
2. `stableEventKey` wybiera `event_id`, `kommo_event_id`, `id`, `uuid` albo `request_id`; gdy ich nie ma, liczy stabilny hash payloadu.
3. Jesli `event_key` juz istnieje, endpoint zwraca 200 z `duplicate: true` i bez aktualizacji `tasks`.
4. Nowy event zapisuje `task_kommo_inbound_events` ze statusem `applied`, `conflict` albo `error`.
5. Konflikt biznesowy, np. reopen zamknietego zlecenia, zostaje w diagnostyce jako `conflict`.

## GO / NO-GO

GO do pilota, jesli:

- `npm run verify:kommo-idempotency-retry` przechodzi.
- Testy `kommo-task-sync-queue` i `kommo-task-inbound-webhook` przechodza.
- Diagnostyka `/api/tasks/kommo-sync/diagnostics` pokazuje bledy outbound i konflikty inbound.
- Zespol wie, kiedy retry `dead_letter` wymaga `force=true`.

NO-GO, jesli:

- webhook Kommo moze powtorzyc event i zmienic zlecenie drugi raz;
- blad outbound nie zostawia wpisu w kolejce retry;
- `dead_letter` mozna ponowic bez swiadomego `force=true`;
- inbound conflict nie trafia do diagnostyki;
- payload/actor snapshot nie jest dostepny do analizy incydentu.

## Automatyczna weryfikacja

```powershell
npm run verify:kommo-idempotency-retry
node os\node_modules\jest\bin\jest.js --runInBand os/tests/kommo-task-sync-queue.test.js os/tests/kommo-task-inbound-webhook.test.js
```
