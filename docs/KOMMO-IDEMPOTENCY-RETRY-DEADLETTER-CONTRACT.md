# Kommo idempotency, retry and dead-letter contract

## Cel

EPIC 8.3 domyka dwukierunkowy sync Kommo tak, zeby replay webhooka, ponowienie outbound `task.sync` albo awaria HTTP nie rozjechaly danych ARBOR.

## Outbound ARBOR -> Kommo

- `buildKommoTaskPayload` zawsze ustawia stabilny `idempotency_key` dla `task.sync`: `arbor:task.sync:task:<task_id>`.
- `postKommoWebhook` wysyla ten sam klucz w headerach `idempotency-key` i `x-idempotency-key`.
- `task_kommo_sync_queue` ma `UNIQUE (task_id, event)` i przechowuje `idempotency_key`, `retry_count`, `next_retry_at`, `last_http_status`, `last_error`, `payload_json`, `actor_json`, `last_attempt_at` i `sent_at`.
- Nieudany outbound przechodzi do `failed`, a po limicie prob do `dead_letter`.
- `POST /api/tasks/:id/kommo-retry` nie ponawia `dead_letter` bez `force=true`.

## Inbound Kommo -> ARBOR

- `task_kommo_inbound_events.event_key` jest unikalny.
- Klucz eventu pochodzi z `event_id`, `kommo_event_id`, `id`, `uuid`, `request_id` albo stabilnego hash payloadu.
- Replay tego samego eventu zwraca `duplicate: true` i nie wykonuje ponownego `UPDATE tasks`.
- Konflikt na zamknietym zleceniu zapisuje `status = 'conflict'`, `conflict_reason` i nie otwiera zadania ponownie.

## Inbound CRM webhook

- Publiczny webhook `POST /api/webhooks/crm/:token` czyta `Idempotency-Key` albo `X-Idempotency-Key`.
- `crmIntegrations.ingestWebhook` traktuje `Idempotency-Key`, `idempotency_key`, `idempotencyKey`, `external_id` albo `id` jako stabilny identyfikator zdarzenia.
- Replay dla tego samego `app_id`, `event_type` i klucza zwraca `idempotent_replay: true`.
- Replay nie tworzy drugiego `crm_leads` ani drugiego `crm_lead_messages`.
- `crm_integration_events` zapisuje `idempotency_key`, `external_id`, `status`, `lead_id`, payload i blad.

## Diagnostyka

`GET /api/tasks/kommo-sync/diagnostics` zwraca:

- `queue` z `idempotency_key`, statusem kolejki, liczba prob, ostatnim HTTP/error i danymi zlecenia,
- `inbound_events` z event key, statusem, konfliktem i statusem zlecenia,
- `summary.queue_errors`,
- `summary.inbound_conflicts`.

Panel `Integracje -> Kommo task.sync` pokazuje kolejke outbound, `dead_letter`, `retry_count`, `last_error` i inbound konflikty.

## GO

- Ponowienie outbound `task.sync` ma ten sam `idempotency_key` w body i headerach.
- Replay inbound webhooka nie zmienia zadania drugi raz.
- Replay inbound CRM webhooka nie tworzy drugiego leada ani wiadomosci.
- `dead_letter` wymaga swiadomego `force=true`.
- Diagnostyka pozwala odroznic HTTP, blad sieci, konflikt inbound i status retry.

## NO-GO

- Outbound bez stabilnego idempotency key.
- Retry `dead_letter` bez potwierdzenia operatora.
- Inbound replay wykonuje drugi update.
- CRM inbound replay tworzy drugi lead albo wiadomosc.
- Konflikt inbound znika bez sladu w diagnostyce.
