# Ops alert ownership contract

## Cel

EPIC 9.5 domyka operacyjna odpowiedzialnosc za alerty, ktore nie moga zostac anonimowe: Kommo dead-letter/retry, SMS delivery i SLO P1/P2.

## Zasada

- Kazde ryzyko dnia ma `owner_role`, `owner_label` i `escalation`.
- Kommo dead-letter jest widoczne w `GET /api/ops/kierownik-today` jako `risk_report.items[].type = kommo_sync`.
- SMS delivery pozostaje `sms_delivery`, ale ma jawnego ownera kontaktu z klientem.
- Ryzyka bez automatycznej naprawy mozna potwierdzic akcja `acknowledge`, ktora zapisuje decyzje do `ops_action_events`.
- `ops_action_events` jest pamiecia decyzji ownera: kto, kiedy, jaki risk, jaka notatka.
- Panel Integracje pokazuje ownera i eskalacje przy Kommo retry/dead-letter oraz inbound conflict, pozwala filtrowac po oddziale i potwierdzac alert.
- Panel Telefonia pokazuje ownera i eskalacje przy historii SMS delivery, pozwala filtrowac po oddziale i potwierdzac bledy dostawy.
- Kontrola operacyjna pokazuje rejestr potwierdzen ownerow, filtruje `risk_acknowledge` po `risk_type=kommo_sync` albo `risk_type=sms_delivery` i korzysta z tego samego `/ops/action-history`.
- Dzienny digest pokazuje KPI domkniecia potwierdzen ownerow: lacznie, Kommo i SMS. CSV z `/ops/action-history?format=csv` eksportuje `Owner` oraz `Status potwierdzenia`.
- `/ops/owner-alerts/open` pokazuje alerty Kommo/SMS bez potwierdzenia ownera, wylicza aging, `sla_status` i eskalacje `P1`/`P2`.

## Kommo

- Zrodlo: `task_kommo_sync_queue`.
- Statusy monitorowane: `failed`, `dead_letter`.
- `dead_letter` ma severity `critical`.
- Owner: `Dyspozytor/Admin`.
- Escalation: `P1 gdy dead-letter > 0 po 30 min`.

## SMS

- Zrodlo: `sms_history` i `sms_delivery_events`.
- Owner: `Kierownik/Dyspozytor`.
- Escalation: `P2 gdy brak dostarczenia po 30 min`.

## SLO

- `docs/OBSERVABILITY-SLO-RUNBOOK.md` opisuje P1/P2, p95, 5xx, `/api/ready`, storage smoke i wlasciciela dyzuru.
- `docs/PRODUCTION-INCIDENT-RUNBOOK.md` wymaga wpisu `owner`, `severity`, timestampu, decyzji i smoke po naprawie.

## GO

- `npm run verify:ops-alert-ownership` przechodzi.
- `npm run verify:ops-alert-owner-ui` przechodzi.
- `npm run verify:ops-owner-control` przechodzi.
- `kierownik-today` zwraca licznik `kommo_sync_risks`.
- Panel Kierownika pokazuje ownera przy ryzyku i pozwala potwierdzic `kommo_sync`.
- Panel Integracje i Panel Telefonia pozwalaja ownerowi zapisac potwierdzenie do `ops_action_events`.
- Kontrola operacyjna pozwala dyrekcji filtrowac potwierdzenia ownerow Kommo/SMS.
- Digest i CSV pozwalaja sprawdzic, ile potwierdzen Kommo/SMS zostalo domknietych danego dnia.
- Kontrola operacyjna pokazuje niedomkniete alerty ownerow z aging SLA; Kommo dead-letter po SLA eskaluje do P1, SMS do P2.
- Kommo/SMS dead-letter nie zostaje bez ownera i zapisu w `ops_action_events`.

## NO-GO

- `kommo_sync` istnieje tylko w panelu Integracje i nie trafia do raportu ryzyk dnia.
- Ryzyko nie ma `owner_label` lub `owner_role`.
- Potwierdzenie ryzyka nie zapisuje `ops_action_events`.
- SLO P1/P2 nie ma wlasciciela.
