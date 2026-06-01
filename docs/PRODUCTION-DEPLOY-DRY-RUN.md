# Production deploy dry-run

Cel: przed pierwszym ruchem produkcyjnym przejsc wdrozenie na sucho: env, migracje, bootstrap admina, backup, restore dry-run i smoke po publicznym URL.

Ten dokument nie zawiera sekretow. Sekrety ustawiamy w panelu hostingu, `.env` ignorowanym przez git albo w managerze sekretow.

## 1. Lokalna bramka bez sekretow

Ta bramka sprawdza, czy repo ma komplet skryptow, runbookow i checklist do produkcji:

```powershell
cd C:\Users\paha1\arbor
npm run verify:observability
npm run verify:incident-runbook
npm run verify:backup-rpo
npm run verify:rbac-scope
npm run verify:scale-readiness
npm run deploy:prod:dry-run
npm run deploy:ready:check
npm run check
```

`deploy:prod:dry-run` nie laczy sie z baza i nie wykonuje restore. To statyczny preflight dla sekwencji produkcyjnej.

## 2. Env produkcyjny

Wypisz szablony:

```powershell
npm run deploy:env:print
```

Minimalne zmienne dla backendu:

- `NODE_ENV=production`
- `DATABASE_URL=postgresql://...sslmode=require`
- `JWT_SECRET=<long-random-secret>`
- `PUBLIC_BASE_URL=https://<public-api-host>`
- `CORS_ORIGINS=https://<public-web-host>`
- `METRICS_ENABLED=true`
- `METRICS_TOKEN=<long-random-token>`
- `UPLOAD_STORAGE=s3`
- `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`
- `DB_POOL_MAX=5` na instancje API jako punkt startowy
- `LOGIN_RATE_LIMIT_STORE=redis` i `LOGIN_RATE_LIMIT_REDIS_URL` przy wielu instancjach

Minimalne zmienne dla web:

- `VITE_API_URL=https://<public-api-host>/api`
- `VITE_KOMMO_APP_URL=https://<company>.kommo.com`

Minimalne zmienne dla mobile:

- `EXPO_PUBLIC_API_URL=https://<public-api-host>/api`
- `EXPO_PUBLIC_WEB_APP_URL=https://<public-web-host>`
- `EXPO_PUBLIC_EXPECTED_API_VERSION=1.0.0`

## 3. Doctor przed migracja

Na wypelnionym env uruchom:

```powershell
npm run deploy:prod:doctor
```

Lokalny smoke bez sekretow i bez sieci:

```powershell
npm run deploy:prod:doctor -- --skip-db --skip-storage
```

## 4. Migracje i admin

Na tej samej bazie, ktora bedzie obslugiwac produkcje:

```powershell
npm run db:migrate -w arbor-os
$env:BOOTSTRAP_ADMIN_LOGIN="admin"
$env:BOOTSTRAP_ADMIN_PASSWORD="<strong-password>"
npm run bootstrap:admin -w arbor-os
```

Alternatywnie przez lokalny plik env:

```powershell
Copy-Item deploy/local-production-doctor.env.example deploy/local-production.env
# edit deploy/local-production.env
npm run deploy:prod:bootstrap
```

## 5. Backup i restore dry-run

Po migracji i bootstrapie admina:

```powershell
npm run backup:db:check
npm run backup:db
npm run restore:db:check
```

`restore:db:check` ma potwierdzic, ze najnowszy dump jest czytelny. Pelny restore wykonuj tylko na swiezej albo swiadomie wymiennej bazie i tylko z `CONFIRM_RESTORE=YES`, zgodnie z `docs/backup-restore.md`.
Mierzalne RPO/RTO, harmonogram, restore drill na bazie replaceable i dowody opisuje `docs/BACKUP-RPO-RTO-RUNBOOK.md`.

## 6. Deploy i publiczny smoke

Po wdrozeniu API:

```powershell
npm run deploy:free:check -- https://<arbor-os-url>
npm run smoke:render -- https://<arbor-os-url>
npm run smoke:p95 -- https://<arbor-os-url> --threshold 500 --samples 5
```

Po utworzeniu admina dodaj authenticated smoke:

```powershell
$env:SMOKE_LOGIN="admin"
$env:SMOKE_PASSWORD="<same-password-used-for-bootstrap>"
npm run smoke:render -- https://<arbor-os-url>
npm run smoke:p95 -- https://<arbor-os-url> --threshold 500 --samples 5
```

Authenticated smoke sprawdza `/api/auth/me`, `/api/ops/smoke` oraz `/api/ops/storage-smoke`. Przy `UPLOAD_STORAGE=s3` wykrywa zle klucze, prywatny bucket albo uszkodzony `S3_PUBLIC_BASE_URL` zanim realne zdjecia trafia do klientow.

## 7. GO / NO-GO

GO:

- `npm run deploy:prod:dry-run` przechodzi.
- `npm run deploy:ready:check` przechodzi.
- Migracje przeszly na produkcyjnym `DATABASE_URL`.
- Admin produkcyjny loguje sie tylko znanym, silnym haslem.
- `backup:db`, `restore:db:check` i publiczny `smoke:render` sa zielone.
- `smoke:p95` przechodzi pod progiem 500 ms dla krytycznych GET endpointow.
- `PUBLIC_BASE_URL`, `CORS_ORIGINS`, `VITE_API_URL`, `EXPO_PUBLIC_API_URL` wskazuja publiczne HTTPS hosty.

NO-GO:

- Brak `DATABASE_URL`, `JWT_SECRET`, `PUBLIC_BASE_URL` albo `CORS_ORIGINS`.
- `PUBLIC_BASE_URL` prowadzi do panelu web zamiast API.
- `UPLOAD_STORAGE=local` przy realnych zdjeciach terenowych na Render Free.
- Wiele instancji API uzywa `LOGIN_RATE_LIMIT_STORE=memory`.
- Backup nie powstal albo `restore:db:check` nie czyta najnowszego dumpa.
- `smoke:render` nie przechodzi po publicznym URL.
- `ops/storage-smoke` nie przechodzi przy storage S3/R2.
