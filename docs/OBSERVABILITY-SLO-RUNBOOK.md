# Observability and SLO minimum

Cel: miec minimalny, operacyjny obraz produkcji ARBOR przed startem oddzialu: czy API zyje, czy baza odpowiada, czy storage dziala, czy rosna 5xx i czy p95 krytycznych endpointow miesci sie w progu.

## 1. Bramka lokalna

```powershell
cd C:\Users\paha1\arbor
npm run verify:observability
npm run health
npm run deploy:prod:doctor -- --skip-db --skip-storage
```

`verify:observability` jest statyczna bramka repo. Nie laczy sie z produkcja i nie wymaga sekretow.

## 2. Endpointy zdrowia

- `/api/health` - szybki health aplikacji, bez DB.
- `/api/ready` - readiness z pingiem bazy.
- `/api/metrics` - metryki Prometheus, wlaczane przez `METRICS_ENABLED=true`.
- `/api/ops/smoke` - smoke aplikacyjny po zalogowaniu jako Prezes/Dyrektor/Administrator.
- `/api/ops/storage-smoke` - test zapisu, publicznego odczytu i sprzatania upload storage.

W produkcji `/api/metrics` musi miec `METRICS_TOKEN`; brak tokena oznacza 401.

## 3. Minimalne SLO

| Obszar | SLO | Alert |
| --- | --- | --- |
| API availability | `/api/ready` 99.5% w godzinach pracy | 2 kolejne nieudane checki albo 5 min down |
| API errors | 5xx < 1% requestow w 15 min | 5xx >= 1% przez 15 min albo >= 5 bledow w 5 min |
| API latency | p95 krytycznych endpointow < 500 ms | p95 >= 500 ms przez 15 min |
| Web TTI | krytyczne ekrany panelu <= 3000 ms | `smoke:web:tti` fail albo TTI > 3000 ms |
| DB pool | `arbor_db_pool_waiting = 0` | waiting > 0 przez 5 min |
| Horizontal scaling | brak lokalnego stanu krytycznego | `UPLOAD_STORAGE=local`, `LOGIN_RATE_LIMIT_STORE=memory` albo podwojny cron przy wielu instancjach |
| Storage | `/api/ops/storage-smoke` OK | dowolny blad smoke storage |
| Kommo/SMS | retry/dead-letter nie rosnie bez wlasciciela | dead-letter > 0 albo retry starsze niz 30 min |
| Backup | backup dzienny i czytelny restore dry-run | brak backupu z 24 h albo `restore:db:check` fail |

Krytyczne endpointy p95:

- `GET /api/ready`
- `GET /api/tasks/wszystkie`
- `GET /api/ops/kierownik-today`
- `POST /api/dispatch/plan`
- `POST /api/tasks/:id/start`
- `POST /api/tasks/:id/finish`
- `GET /api/bi/drill`

## 4. Metryki Prometheus

Wlacz w backendzie:

```env
METRICS_ENABLED=true
METRICS_TOKEN=<long-random-token>
```

Najwazniejsze serie:

- `arbor_http_requests_total{status=~"5.."}` - bledy 5xx.
- `arbor_http_duration_seconds_bucket` - histogram do p95.
- `arbor_db_pool_total`, `arbor_db_pool_idle`, `arbor_db_pool_waiting` - pula Postgres.

Przykladowe PromQL:

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

## 5. Produkcyjny smoke

Po deployu API:

```powershell
npm run smoke:render -- https://<arbor-os-url>
npm run smoke:p95 -- https://<arbor-os-url> --threshold 500 --samples 5
```

Po deployu web:

```powershell
npm run smoke:web:tti -- https://<arbor-web-url> --threshold 3000
```

Po utworzeniu admina:

```powershell
$env:SMOKE_LOGIN="admin"
$env:SMOKE_PASSWORD="<same-password-used-for-bootstrap>"
npm run smoke:render -- https://<arbor-os-url>
npm run smoke:p95 -- https://<arbor-os-url> --threshold 500 --samples 5
```

Authenticated smoke musi obejmowac `/api/ops/smoke` i `/api/ops/storage-smoke`.
Authenticated p95 smoke mierzy dodatkowo `/api/auth/me`, `/api/tasks/wszystkie`, `/api/ops/kierownik-today` i `/api/bi/drill`. Domyslny prog PASS/FAIL to 500 ms.

## 6. Prosty alert operacyjny

Minimalna eskalacja przed pelnym APM:

1. Monitor HTTP odpytuje `/api/ready` co 60 sekund.
2. Monitor metryk odpytuje `/api/metrics` z `METRICS_TOKEN`.
3. Alarm P1 idzie do wlasciciela dyzuru, gdy:
   - `/api/ready` nie odpowiada 2 razy z rzedu;
   - 5xx >= 1% przez 15 min;
   - p95 krytycznych endpointow >= 500 ms przez 15 min;
   - `arbor_db_pool_waiting > 0` przez 5 min;
   - `/api/ops/storage-smoke` zwraca 503.
4. Alarm P2 idzie do backlogu operacyjnego, gdy:
   - storage jest lokalny na Render Free przy realnych zdjeciach;
   - backup jest starszy niz 24 h;
   - restore dry-run nie byl robiony w ostatnim miesiacu;
   - Kommo/SMS ma dead-letter bez wlasciciela.

Szczegolowe kroki reakcji sa w `docs/PRODUCTION-INCIDENT-RUNBOOK.md`.
Gotowosc horizontal scaling opisuje `docs/HORIZONTAL-SCALING-READINESS.md`; przy wielu instancjach pilnuj `LOGIN_RATE_LIMIT_STORE=redis`, `UPLOAD_STORAGE=s3`, jednego wlasciciela cronow i `arbor_db_pool_waiting = 0`.

## 7. GO / NO-GO

GO:

- `npm run verify:observability` przechodzi.
- `/api/health`, `/api/ready` i publiczny `smoke:render` przechodza.
- `npm run smoke:p95 -- https://<arbor-os-url>` przechodzi pod progiem 500 ms.
- `METRICS_ENABLED=true` i `METRICS_TOKEN` sa ustawione w produkcji.
- Znamy wlasciciela alertow P1/P2.
- Backup i `restore:db:check` sa aktualne.

NO-GO:

- `/api/ready` nie sprawdza bazy albo zwraca 503.
- `/api/metrics` jest publiczne bez tokena w produkcji.
- Brak progu 5xx lub p95 dla krytycznych endpointow.
- `/api/ops/storage-smoke` nie przechodzi przy storage S3/R2.
- Nie ma wlasciciela alertow ani miejsca zapisu incydentow.
