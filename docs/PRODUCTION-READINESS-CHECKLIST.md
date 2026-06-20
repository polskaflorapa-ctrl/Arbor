# ARBOR production readiness checklist

Cel: jedna lista GO/NO-GO dla pierwszego lub kolejnego wdrozenia produkcyjnego ARBOR. Sekrety wpisujemy tylko w panelu hostingu, managerze sekretow albo lokalnym pliku `.env` ignorowanym przez git.

## 0. Szybka bramka lokalna

Uruchom przed zmianami w panelach hostingu:

```powershell
cd C:\Users\paha1\arbor
npm run prod:ready
```

Po deployu publicznym dodaj smoke po URL:

```powershell
npm run prod:ready -- --base-url https://<arbor-os-url> --web-url https://<arbor-web-url>
```

`prod:ready` obejmuje: env/runbook checks, produkcyjny dry-run, web TTI contract, scale/observability/backup checks, kontrakty produktu, mobilny `release:check:quick`, lokalny build web, deploy-ready static checks oraz opcjonalne publiczne API/TTI smoke.

## 1. Env

- `os`: `NODE_ENV=production`, `DATABASE_URL`, silny `JWT_SECRET`, `PUBLIC_BASE_URL`, `CORS_ORIGINS`.
- `os`: `UPLOAD_STORAGE=s3` oraz komplet `S3_*` dla realnych zdjec, PDF i protokolow.
- `os`: `LOGIN_RATE_LIMIT_STORE=redis` i `LOGIN_RATE_LIMIT_REDIS_URL`, jezeli API ma wiecej niz jedna instancje.
- `os`: `METRICS_ENABLED=true` tylko z `METRICS_TOKEN` i kontrolowanym dostepem.
- `web`: `VITE_API_URL=https://<arbor-os-url>/api`.
- `mobile`: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WEB_APP_URL`, `EXPO_PUBLIC_EXPECTED_API_VERSION`.
- Integracje opcjonalne: Kommo, Zadarma, SMTP, Telegram, OpenAI ustawione dopiero wtedy, gdy wlasciciel procesu potwierdzi dane.

Wydruk szablonow:

```powershell
npm run deploy:env:print
```

## 2. Build

- `npm install` wykonane na Node zgodnym z `.nvmrc` i `package.json`.
- `npm run build` przechodzi i synchronizuje `web/build`.
- `npm run verify:web:test` przechodzi dla krytycznych testow frontu.
- `npm run verify:os` przechodzi dla backendu.
- `npm run verify:mobile` przechodzi przed buildem Expo.
- `npm run release:check:quick -w arbor-mobile` przechodzi przed buildem Expo/TestFlight/Google Play.

Minimalna lokalna bramka:

```powershell
npm run check
```

## 3. Baza i bootstrap

- Migracje wykonane na docelowym `DATABASE_URL`:

```powershell
npm run db:migrate -w arbor-os
```

- Pierwszy admin utworzony jednorazowo:

```powershell
$env:BOOTSTRAP_ADMIN_LOGIN="admin"
$env:BOOTSTRAP_ADMIN_PASSWORD="<strong-password>"
npm run bootstrap:admin -w arbor-os
```

- Haslo admina zapisane poza repo i przekazane tylko wlascicielowi operacyjnemu.

## 4. Backup

- `npm run backup:db:check` przechodzi.
- `npm run backup:db` tworzy dump po migracjach i bootstrapie.
- `npm run restore:db:check` czyta najnowszy dump.
- RPO/RTO i ostatni restore drill wpisane zgodnie z `docs/BACKUP-RPO-RTO-RUNBOOK.md`.

## 5. Smoke testy

Przed deployem:

```powershell
npm run deploy:prod:dry-run
npm run deploy:ready:check
npm run smoke:critical-path
```

Po deployu API:

```powershell
npm run deploy:free:check -- https://<arbor-os-url>
npm run smoke:render -- https://<arbor-os-url>
npm run smoke:p95 -- https://<arbor-os-url> --threshold 500 --samples 5
```

Po deployu web:

```powershell
$env:ARBOR_WEB_TTI_BASE="https://<arbor-web-url>"
npm run smoke:web:tti -- --threshold 3000 --mobile
```

Authenticated smoke, gdy admin juz istnieje:

```powershell
$env:SMOKE_LOGIN="admin"
$env:SMOKE_PASSWORD="<admin-password>"
npm run smoke:render -- https://<arbor-os-url>
```

## 6. Deployment

- `PUBLIC_BASE_URL` wskazuje publiczny HTTPS backend, nie panel web.
- `CORS_ORIGINS` zawiera dokladny publiczny URL panelu web.
- Web zbudowany po ustawieniu finalnego `VITE_API_URL`.
- Mobile build Expo wykonany po ustawieniu finalnych `EXPO_PUBLIC_*`.
- Mobile store metadata, support URL, privacy URL i review notes przechodza przez `release:check:quick`.
- Zadarma webhooki wskazuja `https://<arbor-os-url>/api/sms/webhooks/zadarma`.
- Kommo inbound wskazuje publiczne endpointy `arbor-os`.
- Crony produkcyjne maja `OPS_CRON_SECRET` i nie sa zdublowane na wielu instancjach.

## GO

- `npm run prod:ready -- --base-url https://<arbor-os-url> --web-url https://<arbor-web-url>` przechodzi.
- Migracje, bootstrap admina, backup i restore dry-run sa zielone.
- Publiczny smoke API i web TTI sa zielone.
- Mobilny `release:check:quick` jest zielony dla docelowej konfiguracji API.
- Storage smoke przechodzi przy `UPLOAD_STORAGE=s3`.
- Monitoring i runbook incydentowy sa gotowe.

## NO-GO

- Brakuje `DATABASE_URL`, `JWT_SECRET`, `PUBLIC_BASE_URL`, `CORS_ORIGINS` albo `VITE_API_URL`.
- Produkcyjne zdjecia uzywaja tylko lokalnego storage na efemerycznym hostingu.
- Backup nie powstal lub restore dry-run nie czyta dumpa.
- `smoke:render`, `smoke:p95` albo `smoke:web:tti` nie przechodzi.
- Mobilny `release:check:quick` nie przechodzi albo store metadata/review notes nie sa aktualne.
- Publiczne linki klienta, SMS lub webhooki wskazuja localhost, domeny stagingowe albo panel web zamiast API.
