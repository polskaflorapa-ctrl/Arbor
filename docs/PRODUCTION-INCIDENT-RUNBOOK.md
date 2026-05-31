# Production incident runbook

Cel: miec jedna instrukcje na pierwsze 30 minut incydentu produkcyjnego ARBOR. Ten runbook obejmuje down API, wolne p95, storage fail, Kommo/SMS dead-letter oraz awaryjny restore.

## 1. Zasady incydentu

- Najpierw zatrzymaj utrate danych, potem przywracaj wygode pracy.
- Nie wykonuj `restore:db` na produkcyjnej bazie bez decyzji wlasciciela incydentu.
- Nie uruchamiaj ponownie masowych retry Kommo/SMS, jesli nie znasz przyczyny bledu.
- Kazdy incydent P1 musi miec wlasciciela, timestamp, objaw, decyzje i wynik smoke po naprawie.

## 2. Szybka triage

```powershell
cd C:\Users\paha1\arbor
npm run health
npm run status:json:strict
npm run verify:observability
npm run smoke:p95 -- https://<arbor-os-url> --threshold 500 --samples 5
npm run deploy:prod:doctor -- --skip-storage
```

Po publicznym URL:

```powershell
npm run smoke:render -- https://<arbor-os-url>
npm run smoke:p95 -- https://<arbor-os-url> --threshold 500 --samples 5
```

Z adminem produkcyjnym:

```powershell
$env:SMOKE_LOGIN="admin"
$env:SMOKE_PASSWORD="<admin-password>"
npm run smoke:render -- https://<arbor-os-url>
```

## 3. API down albo `/api/ready` 503

Objawy:

- `/api/ready` zwraca 503 albo timeout.
- `npm run smoke:render -- https://<arbor-os-url>` nie przechodzi na checku ready.
- Web pokazuje bledy sieci albo 5xx.

Kroki:

1. Sprawdz logi hostingu dla `arbor-os`.
2. Sprawdz env: `DATABASE_URL`, `JWT_SECRET`, `PUBLIC_BASE_URL`, `CORS_ORIGINS`.
3. Uruchom doctor z produkcyjnym env:

```powershell
npm run deploy:prod:doctor
```

4. Jesli DB nie odpowiada, sprawdz Neon/pooler i `DB_POOL_MAX`.
5. Po restarcie API uruchom:

```powershell
npm run smoke:render -- https://<arbor-os-url>
```

Kryterium zamkniecia: `/api/ready` 200, `smoke:render` zielony, brak nowych 5xx przez 15 min.

## 4. Wolne p95 albo wzrost 5xx

Objawy:

- p95 krytycznych endpointow >= 500 ms przez 15 min.
- 5xx >= 1% przez 15 min albo >= 5 bledow w 5 min.
- `arbor_db_pool_waiting > 0` przez 5 min.

Kroki:

1. Sprawdz `/api/metrics` z `METRICS_TOKEN`.
2. W Prometheus/Grafanie sprawdz:

```promql
sum(rate(arbor_http_requests_total{status=~"5.."}[5m]))
/
sum(rate(arbor_http_requests_total[5m]))
```

```promql
histogram_quantile(
  0.95,
  sum by (le, path) (rate(arbor_http_duration_seconds_bucket[5m]))
)
```

3. Sprawdz `arbor_db_pool_waiting`, `arbor_db_pool_total`, `arbor_db_pool_idle`.
4. Jesli problem dotyczy jednego endpointu, ogranicz ruch lub wycofaj ostatnia zmiane.
5. Jesli waiting pool rosnie, obniz konkurencje workerow/retry i sprawdz zapytania DB.

Kryterium zamkniecia: p95 < 500 ms przez 15 min, 5xx < 1%, `arbor_db_pool_waiting = 0`.
Szybki dowod po naprawie: `npm run smoke:p95 -- https://<arbor-os-url> --threshold 500 --samples 5`.

## 5. Storage fail

Objawy:

- `storage-smoke` zwraca 503.
- Zdjecia/protokoly nie otwieraja sie publicznie.
- `S3_PUBLIC_BASE_URL` prowadzi do prywatnego albo zlego hosta.

Kroki:

1. Uruchom authenticated smoke:

```powershell
$env:SMOKE_LOGIN="admin"
$env:SMOKE_PASSWORD="<admin-password>"
npm run smoke:render -- https://<arbor-os-url>
```

2. Sprawdz env storage: `UPLOAD_STORAGE=s3`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`.
3. Jesli API jest na Render Free i `UPLOAD_STORAGE=local`, oznacz incydent jako ryzyko utraty zalacznikow i przejdz na S3/R2 przed dalszymi zdjeciami terenowymi.
4. Po zmianie env zrestartuj API i powtorz `/api/ops/storage-smoke`.

Kryterium zamkniecia: `storage-smoke` 200, publiczny odczyt pliku testowego OK, nowe zdjecie z mobile widoczne w web.

## 6. Kommo dead-letter albo retry stoi

Kontrolowany drill dla Kommo i SMS jest opisany w `docs/KOMMO-SMS-INCIDENT-DRILL.md`.

Objawy:

- Panel Integracje pokazuje `dead_letter`.
- `/api/tasks/kommo-sync/diagnostics` ma `queue_errors > 0`.
- Zlecenie nie wyszlo do Kommo po finish/status change.

Kroki:

1. Otworz web: `Integracje -> Kommo sync`.
2. Sprawdz diagnostyke API:

```text
GET /api/tasks/kommo-sync/diagnostics
```

3. Sprawdz `last_error`, `last_http_status`, `retry_count`, `next_retry_at`.
4. Jesli status to `dead_letter`, nie wymuszaj retry bez sprawdzenia konfliktu.
5. Po naprawie mapowania/env/webhooka wykonaj retry pojedynczego zlecenia:

```text
POST /api/tasks/:id/kommo-retry
POST /api/tasks/:id/kommo-retry { "force": true }
```

`force=true` tylko po potwierdzeniu, ze konflikt Kommo vs ARBOR jest rozstrzygniety.

Kryterium zamkniecia: `queue_errors = 0`, brak `dead_letter`, Kommo ma status/czas/zdjecia/koszty/marze dla zlecen testowych.

## 7. SMS/Zadarma delivery fail

Objawy:

- Klient nie dostaje SMS z linkiem statusowym albo oknem czasowym.
- `sms_history` ma `delivery_error_code`.
- `sms_delivery_events` pokazuje status bledu.
- Raport ryzyk dnia pokazuje `sms_delivery`.

Kroki:

1. Sprawdz panel Telefonia i historie SMS zlecenia.
2. Sprawdz env: `ZADARMA_API_KEY`, `ZADARMA_API_SECRET`, `ZADARMA_CALLER_ID`, `PUBLIC_BASE_URL`.
3. Sprawdz webhook Zadarma:

```text
https://<api-host>/api/sms/webhooks/zadarma
https://<api-host>/api/sms/webhooks/zadarma/status
```

4. Jesli blad dotyczy jednego klienta, uzyj akcji z raportu ryzyk: ponow SMS albo telefon Zadarma.
5. Jesli blad jest globalny, wylacz wysylki masowe i przejdz na telefon/manualny kontakt do czasu naprawy providera.

Kryterium zamkniecia: nowy SMS ma status dostarczenia albo znany, zaakceptowany fallback; `sms_delivery` znika z raportu ryzyk dnia.

## 8. Awaryjny restore

Restore jest P1/P0 i wymaga potwierdzenia wlasciciela incydentu.

Najpierw sprawdz backup:

```powershell
npm run backup:db:check
npm run restore:db:check
npm run restore:db:check -- --file "C:\Users\paha1\arbor\os\backups\latest.dump"
```

Jesli restore jest konieczny, uzyj swiezej albo swiadomie wymiennej bazy. Skrypt odmowi pracy bez `CONFIRM_RESTORE=YES`.

```powershell
$env:DATABASE_URL="postgresql://<user>:<password>@<target-host>/<target-db>?sslmode=require"
$env:CONFIRM_RESTORE="YES"
npm run restore:db -- --file "C:\Users\paha1\arbor\os\backups\latest.dump"
```

Restore z czyszczeniem obiektow:

```powershell
$env:RESTORE_CLEAN="1"
$env:CONFIRM_RESTORE="YES"
npm run restore:db -- --file "C:\Users\paha1\arbor\os\backups\latest.dump"
```

Po restore:

```powershell
npm run deploy:prod:doctor
npm run smoke:render -- https://<arbor-os-url>
```

Kryterium zamkniecia: admin loguje sie, `/api/ready` 200, krytyczne zlecenia sa obecne, najnowszy backup po naprawie wykonany.

## 9. Komunikacja

Minimalny wpis incydentu:

- `started_at`
- `owner`
- `severity`: P1/P2/P3
- `symptom`
- `customer_impact`
- `decision_log`
- `commands_run`
- `resolved_at`
- `followups`

Po kazdym P1 dopisz follow-up do backlogu i uruchom:

```powershell
npm run verify:observability
npm run check
```

## 10. GO / NO-GO po incydencie

GO:

- `smoke:render` zielony po publicznym URL.
- `verify:observability` i `check` przechodza po zmianie.
- Wlasciciel potwierdzil brak aktywnej utraty danych.
- Follow-up trafil do backlogu.

NO-GO:

- Nie ma aktualnego backupu albo `restore:db:check` nie przechodzi.
- `storage-smoke` nadal zwraca 503 przy realnych zdjeciach.
- Kommo/SMS dead-letter nadal rosnie bez wlasciciela.
- `/api/ready` albo p95/5xx nadal lamia SLO.
