# ARBOR-OS environment runbook

Ten dokument jest operacyjna mapa konfiguracji dla `os`, `web`, `mobile`, Kommo, Zadarma i publicznych linkow. Sekrety trzymamy tylko w `.env`, panelach hostingu albo managerze sekretow, nigdy w repo.

## Zasada bazowa

- `os` jest zrodlem prawdy dla API, bazy, Kommo, Zadarma, linkow publicznych, storage i cronow.
- `web` zna tylko adres API i opcjonalny link do aplikacji Kommo.
- `mobile` zna tylko adres API, adres panelu web i oczekiwana wersje API.
- Publiczne linki dla klienta, Zadarma webhooki i statusy SMS wymagaja jednego HTTPS hosta w `PUBLIC_BASE_URL`.

## Lokalne uruchomienie

1. Zainstaluj zaleznosci:

```powershell
npm install
```

2. Skopiuj szablony:

```powershell
Copy-Item os\.env.example os\.env
Copy-Item web\.env.example web\.env
Copy-Item mobile\.env.example mobile\.env
```

3. Uruchom baze i migracje:

```powershell
npm run up
npm run db:migrate -w arbor-os
```

4. Uruchom backend i panel:

```powershell
npm run dev:os
npm run dev:web
```

5. Dla telefonu w tej samej sieci ustaw w `mobile/.env` adres komputera, nie `localhost`:

```env
EXPO_PUBLIC_API_URL=http://192.168.0.10:3000/api
EXPO_PUBLIC_WEB_APP_URL=http://192.168.0.10:5173
```

## Minimalne zmienne per aplikacja

### `os/.env`

Wymagane lokalnie:

```env
NODE_ENV=development
PORT=3000
JWT_SECRET=dev-local-secret
DB_HOST=localhost
DB_PORT=5432
DB_NAME=arbor_dev
DB_USER=postgres
DB_PASSWORD=postgres
CORS_ORIGINS=http://localhost:5173,http://localhost:5174
```

Wymagane produkcyjnie:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://<user>:<password>@<host>/<db>?sslmode=require
JWT_SECRET=<long-random-secret>
PUBLIC_BASE_URL=https://api.twoja-domena.pl
CORS_ORIGINS=https://app.twoja-domena.pl
UPLOAD_STORAGE=s3
S3_BUCKET=<bucket>
S3_PUBLIC_BASE_URL=https://<public-bucket-or-domain>
LOGIN_RATE_LIMIT_STORE=redis
LOGIN_RATE_LIMIT_REDIS_URL=redis://<user>:<password>@<redis-host>:6379
METRICS_ENABLED=true
METRICS_TOKEN=<long-random-token>
```

### `web/.env`

Lokalnie z proxy Vite:

```env
VITE_API_URL=/api
```

Produkcja, gdy backend jest na osobnym hoscie:

```env
VITE_API_URL=https://api.twoja-domena.pl/api
VITE_KOMMO_APP_URL=https://twoja-firma.kommo.com
```

### `mobile/.env`

```env
EXPO_PUBLIC_API_URL=https://api.twoja-domena.pl/api
EXPO_PUBLIC_WEB_APP_URL=https://app.twoja-domena.pl
EXPO_PUBLIC_EXPECTED_API_VERSION=1.0.0
```

## Zadarma jako glowna telefonia/SMS

Najprosciej ustawic Zadarme w panelu webowym:

```text
Telefonia -> Zadarma
```

Wklej tam `API key`, `API secret` i `caller_id`/nadawce SMS, a potem kliknij `Test API`.
Klucze zapisane z panelu sa trzymane w bazie w postaci szyfrowanej i uzywane przez:

- wysylke SMS,
- statusy dostarczenia SMS,
- przycisk `Telefon / polacz do klienta` przez Zadarma Callback API.

Alternatywnie ustaw w `os/.env` albo panelu hostingu:

```env
ZADARMA_API_KEY=<key>
ZADARMA_API_SECRET=<secret>
ZADARMA_CALLER_ID=ARBOR
PUBLIC_BASE_URL=https://api.twoja-domena.pl
```

`ZADARMA_API_KEY` i `ZADARMA_API_SECRET` bierz z panelu Zadarma: **Settings / Integrations and API / API keys**.

Przycisk `polacz do klienta` dzwoni najpierw na numer telefonu zapisany w profilu uzytkownika ARBOR, a po odebraniu laczy z numerem klienta.
Dlatego kazdy uzytkownik, ktory ma dzwonic z panelu, musi miec uzupelnione pole `telefon` w formacie `+48...`.

Polaczenia przychodzace ustawiasz w panelu Zadarma po stronie numeru/PBX:

- podlacz kupiony numer DID do SIP/PBX/scenariusza albo przekierowania na telefon pracownika,
- dla zwyklego odbierania telefonow ARBOR nie musi posredniczyc w audio,
- jezeli chcesz automatyczne intake/lead z rozmow przychodzacych, wlacz oddzielnie integracje agenta glosowego w module Telefonia.

W panelu Zadarma wlacz webhook notifications dla SMS i ustaw:

```text
https://api.twoja-domena.pl/api/sms/webhooks/zadarma
```

Alias kompatybilny:

```text
https://api.twoja-domena.pl/api/sms/webhooks/zadarma/status
```

`PUBLIC_BASE_URL` musi byc publicznym HTTPS adresem backendu. Bez tego statusy SMS, linki statusowe klienta, linki okien czasowych i czesc telefonii beda niepelne.

## Kommo

Backend wysyla zdarzenia do Kommo/Make/n8n przez:

```env
KOMMO_WEBHOOK_URL=https://hook.example/...
KOMMO_CRM_WEBHOOK_URL=https://hook.example/crm
KOMMO_WEBHOOK_SECRET_HEADER=X-Arbor-Webhook-Secret
KOMMO_WEBHOOK_SECRET=<secret>
KOMMO_PIPELINE_ID=<id>
KOMMO_STATUS_ID=<id>
KOMMO_RESPONSIBLE_USER_ID=<id>
```

Inbound do ARBOR:

```text
POST https://api.twoja-domena.pl/api/webhooks/kommo/task-sync
POST https://api.twoja-domena.pl/api/webhooks/kommo/quotation-lead
```

Po zmianie mapowania uruchom smoke:

```powershell
npm run smoke:kommo:crm -w arbor-web
```

## Publiczne linki klienta

Te funkcje bazuja na `PUBLIC_BASE_URL`:

- `/track/:token` - publiczny status zlecenia.
- `/api/tasks/time-window/:token` - akceptacja lub odrzucenie okna czasowego.
- webhooki Zadarma.
- linki protokolu i wybrane linki PDF.

Nie ustawiaj tu adresu panelu web, jesli publiczne endpointy sa wystawione przez osobny backend.

## Kolejnosc wdrozenia produkcyjnego

1. Utworz baze i ustaw `DATABASE_URL`.
2. Ustaw `JWT_SECRET`, `PUBLIC_BASE_URL`, `CORS_ORIGINS`.
3. Ustaw storage `UPLOAD_STORAGE=s3` i `S3_*`.
4. Uruchom migracje:

```powershell
npm run db:migrate -w arbor-os
```

5. Utworz administratora:

```powershell
$env:BOOTSTRAP_ADMIN_LOGIN="admin"
$env:BOOTSTRAP_ADMIN_PASSWORD="<strong-password>"
npm run bootstrap:admin
```

6. Ustaw `VITE_API_URL` w panelu web i zbuduj frontend.
7. Ustaw `EXPO_PUBLIC_API_URL` oraz `EXPO_PUBLIC_WEB_APP_URL` przed buildem Expo.
8. Skonfiguruj Kommo i Zadarma.
9. Uruchom weryfikacje:

```powershell
npm run deploy:prod:dry-run
npm run verify:scale-readiness
npm run verify:observability
npm run release:check:quick -w arbor-mobile
npm run deploy:ready:check
npm run test:critical-path -w arbor-os
npm run smoke:kommo:crm -w arbor-web
```

10. Po migracji i bootstrapie admina wykonaj backup i sprawdz, ze dump jest czytelny:

```powershell
npm run backup:db
npm run restore:db:check
```

11. Po deployu API uruchom smoke po publicznym URL:

```powershell
npm run smoke:render -- https://<arbor-os-url>
npm run smoke:p95 -- https://<arbor-os-url> --threshold 500 --samples 5
```

Pelny suchy przebieg produkcyjny jest w `docs/PRODUCTION-DEPLOY-DRY-RUN.md`.

## Szybka diagnostyka

```powershell
npm run doctor
npm run status
npm run health
npm run verify:env-runbook
```

Gdy publiczne linki w SMS-ach sa puste albo prowadza na localhost, sprawdz w pierwszej kolejnosci `PUBLIC_BASE_URL` na backendzie oraz `CORS_ORIGINS` dla panelu.

Minimalne SLO, metryki Prometheus i progi alertow sa w `docs/OBSERVABILITY-SLO-RUNBOOK.md`.
Gotowosc wielu instancji, `UPLOAD_STORAGE=s3`, Redis dla login limitera i zasady cronow opisuje `docs/HORIZONTAL-SCALING-READINESS.md`.
