# Horizontal scaling readiness

Cel: sprawdzic, czy ARBOR OS moze dzialac na wiecej niz jednej instancji backendu bez ukrytej zaleznosci od lokalnego dysku albo pamieci procesu.

Ten runbook dotyczy pierwszego skalowania API `os`. Web jest statycznym SPA, a mobile trzyma sesje lokalnie na urzadzeniu.

## 1. Zasada skalowania

Backend musi pozostac stateless dla requestow HTTP:

- Sesja uzytkownika jest w JWT podpisanym `JWT_SECRET`, bez server-side session store.
- Kazda instancja `os` musi miec ten sam `JWT_SECRET`.
- Dane aplikacji i kolejki operacyjne sa w Postgres.
- Uploady produkcyjne musza isc do `UPLOAD_STORAGE=s3`, nie do lokalnego `UPLOADS_DIR`.
- Login rate limit przy wielu instancjach musi uzywac `LOGIN_RATE_LIMIT_STORE=redis`.
- Crony i workery musza byc uruchomione pojedynczo albo miec jawny lock/idempotencje.

## 2. Bramka lokalna

```powershell
cd C:\Users\paha1\arbor
npm run verify:scale-readiness
npm run deploy:prod:doctor
npm run smoke:render -- https://<arbor-os-url>
npm run smoke:p95 -- https://<arbor-os-url> --threshold 500 --samples 5
```

Ta bramka nie wlacza drugiej instancji. Potwierdza, ze repo ma komplet guardow i instrukcji przed takim ruchem.

## 3. Wymagane env dla wielu instancji

```env
NODE_ENV=production
JWT_SECRET=<same-long-random-secret-on-every-instance>
DATABASE_URL=postgresql://<user>:<password>@<pooler-host>/<db>?sslmode=require
DB_POOL_MAX=5
DB_CONNECT_TIMEOUT_MS=10000
DB_IDLE_TIMEOUT_MS=10000
UPLOAD_STORAGE=s3
S3_BUCKET=<bucket>
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=<access-key-id>
S3_SECRET_ACCESS_KEY=<secret-access-key>
S3_PUBLIC_BASE_URL=https://<public-bucket-or-custom-domain>
LOGIN_RATE_LIMIT_STORE=redis
LOGIN_RATE_LIMIT_REDIS_URL=redis://<user>:<password>@<redis-host>:6379
METRICS_ENABLED=true
METRICS_TOKEN=<long-random-token>
OPS_CRON_SECRET=<long-random-secret>
```

`LOGIN_RATE_LIMIT_STORE=memory` jest akceptowalne tylko dla jednej instancji albo lokalnego smoke.

## 4. Stan per obszar

### JWT i sesje

`os/src/middleware/auth.js` weryfikuje Bearer token przez `jwt.verify(token, env.JWT_SECRET)`. Nie ma lokalnego session store. Ryzyko: zmiana `JWT_SECRET` na jednej instancji wyloguje albo odrzuci czesc ruchu.

### Uploady

`os/src/services/upload-storage.js` wspiera `UPLOAD_STORAGE=s3` i self-test `/api/ops/storage-smoke`. W wielu instancjach `UPLOAD_STORAGE=local` jest NO-GO dla zdjec, dokumentow, protokolow i nagran.

### Rate limit

`os/src/middleware/rate-limit.js` ma `LOGIN_RATE_LIMIT_STORE=redis` i `LOGIN_RATE_LIMIT_REDIS_URL`. Bez Redis limit logowania jest liczony osobno na kazdej instancji.

### DB pool

`DB_POOL_MAX` dotyczy jednej instancji. Przy N instancjach laczna liczba polaczen to w przyblizeniu `N * DB_POOL_MAX` plus crony i narzedzia administracyjne. Dla Neon/Render startuj od `DB_POOL_MAX=5` na instancje i obserwuj `arbor_db_pool_waiting`.

### Crony i workery

Cron endpointy (`OPS_CRON_SECRET`) i skrypty automatyzacji powinny byc uruchamiane z jednego zrodla: Render Cron, GitHub Actions, osobny worker albo manualny operator. Nie wlaczaj tego samego crona na kazdej instancji API.

`CRM_MESSAGE_QUEUE_WORKER_ENABLED=true` uruchamia lokalny worker procesu dla `crmMessageQueue`. W wielu instancjach wlacz go tylko w jednej dedykowanej instancji/workerze, dopoki kolejka nie ma lease/lock per job.

### SSE / realtime notifications

`/api/notifications/stream` uzywa lokalnej pamieci procesu (`_sseClients`). Dziala jako best-effort realtime na pojedynczej instancji albo przy sticky sessions. Dla wielu instancji bez sticky sessions traktuj SSE jako opcjonalne; dane zrodlowe nadal sa w tabeli `notifications`, a UI moze odswiezac liste.

### Dispatcher

`POST /api/dispatch/plan` liczy plan synchronicznie w procesie API. Dla pilota to OK, bo `arbor-clarke-wright` dziala jako lokalny fallback bez Google/Mapbox. Decyzja docelowa jest w `docs/DISPATCHER-ARCHITECTURE-DECISION.md`: OR-Tools w workerze jako glowny solver, a zewnetrzne API tylko pomocniczo dla macierzy czasu/ETA. Przy wiekszej skali dlugie planowanie powinno przejsc do kolejki/workerow albo miec limit `DISPATCH_SOLVER_TARGET_MS` i rate limit.

## 5. Smoke po podniesieniu drugiej instancji

Po wlaczeniu drugiej instancji:

```powershell
npm run deploy:prod:doctor
npm run smoke:render -- https://<arbor-os-url>
npm run smoke:p95 -- https://<arbor-os-url> --threshold 500 --samples 5
npm run smoke:web:tti -- https://<arbor-web-url> --threshold 3000
```

Manualnie sprawdz:

- logowanie i `/api/auth/me` kilka razy pod rzad;
- upload zdjecia i publiczny odczyt przez `/api/ops/storage-smoke`;
- SMS/Zadarma webhook po publicznym URL;
- Kommo retry/dead-letter nie rosnie po deployu;
- cron/digest nie wykonuje sie podwojnie;
- `arbor_db_pool_waiting = 0`.

## 6. GO / NO-GO

GO:

- `npm run verify:scale-readiness` przechodzi.
- Wszystkie instancje maja ten sam `JWT_SECRET`.
- `UPLOAD_STORAGE=s3` i `/api/ops/storage-smoke` przechodzi.
- `LOGIN_RATE_LIMIT_STORE=redis` jest ustawione dla wielu instancji.
- Crony i `CRM_MESSAGE_QUEUE_WORKER_ENABLED` maja jednego wlasciciela wykonania.
- `DB_POOL_MAX` pomnozone przez liczbe instancji miesci sie w limicie bazy.
- `smoke:render`, `smoke:p95` i `smoke:web:tti` przechodza po publicznym URL.

NO-GO:

- `UPLOAD_STORAGE=local` przy realnych zalacznikach.
- Rozne `JWT_SECRET` miedzy instancjami.
- `LOGIN_RATE_LIMIT_STORE=memory` przy wielu instancjach.
- Ten sam cron albo worker wlaczony na kazdej instancji bez locka.
- SSE jest wymaganiem krytycznym, ale nie ma sticky sessions ani Redis pub/sub.
- `arbor_db_pool_waiting > 0` po skalowaniu.
