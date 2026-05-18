# ARBOR free demo deploy

Cel: szybki pokaz dla prezesa bez platnego serwera. Ten wariant uzywa:

- Railway: API `arbor-os`.
- Neon: Postgres.
- Cloudflare R2: zdjecia, szkice i PDF-y.
- Cloudflare Pages albo Vercel: web `arbor-web`.

## 1. Neon

Utworz projekt Postgres w Neon i skopiuj pooled connection string:

```text
postgresql://<user>:<password>@<neon-pooler-host>/<db>?sslmode=require
```

To bedzie `DATABASE_URL`.

## 2. Cloudflare R2

Utworz bucket, np. `arbor-demo-uploads`, i klucz S3/R2 z prawem read/write.

Wazne zmienne:

```text
UPLOAD_STORAGE=s3
S3_BUCKET=<bucket-name>
S3_REGION=auto
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=<access-key-id>
S3_SECRET_ACCESS_KEY=<secret-access-key>
S3_PUBLIC_BASE_URL=https://<public-bucket-or-custom-domain>
S3_UPLOAD_PREFIX=uploads/demo
S3_FORCE_PATH_STYLE=true
```

Bez publicznego `S3_PUBLIC_BASE_URL` zdjecia moga sie zapisywac, ale ekipa nie
zobaczy ich poprawnie w galerii.

## 3. Railway API

1. Railway -> New Project -> Deploy from GitHub repo `Arbor`.
2. Railway wykryje `railway.json`.
3. Dodaj zmienne z `deploy/railway-arbor-os.env.example`.
4. Ustaw `DATABASE_URL` z Neon.
5. Ustaw R2/S3 zmienne z poprzedniego kroku.
6. Deploy.

`railway.json` robi:

```text
npm ci
npm run start:api:prod
```

`start:api:prod` odpala migracje bazy i dopiero potem startuje API.

Po deployu sprawdz:

```powershell
npm run deploy:free:check -- https://<arbor-os>.up.railway.app
```

## 4. Pierwszy admin i demo dane

Lokalnie utworz ignorowany plik z sekretami:

```powershell
Copy-Item deploy/local-production-doctor.env.example deploy/local-production.env
```

Wklej tam ten sam `DATABASE_URL`, R2/S3 i dane admina:

```text
BOOTSTRAP_ADMIN_LOGIN=admin
BOOTSTRAP_ADMIN_PASSWORD=<long-random-password>
BOOTSTRAP_ADMIN_EMAIL=biuro@example.com
BOOTSTRAP_ADMIN_ROLE=Administrator
BOOTSTRAP_ADMIN_BRANCH_NAME=Centrala
```

Na szybki pokaz, jesli `pg_dump` nie jest jeszcze zainstalowany:

```powershell
npm run deploy:prod:bootstrap -- --skip-backup
```

Docelowo, z PostgreSQL client tools:

```powershell
npm run deploy:prod:bootstrap
```

## 5. Cloudflare Pages web

Opcja w panelu Cloudflare Pages:

```text
Build command: npm ci && npm run build -w arbor-web
Build output directory: web/build
Environment variable:
REACT_APP_API_URL=https://<arbor-os>.up.railway.app/api
```

Opcja z terminala po zalogowaniu `wrangler`:

```powershell
$env:REACT_APP_API_URL="https://<arbor-os>.up.railway.app/api"
npm run deploy:pages:cloudflare
```

## 6. Vercel alternatywnie

Repo ma juz `vercel.json`.

Ustaw:

```text
REACT_APP_API_URL=https://<arbor-os>.up.railway.app/api
```

Output jest `web/build`.

## 7. Finalny smoke

Po stworzeniu admina:

```powershell
$env:SMOKE_LOGIN="admin"
$env:SMOKE_PASSWORD="<same-password-used-for-bootstrap>"
npm run smoke:render -- https://<arbor-os>.up.railway.app
```

Web powinien logowac sie przez Cloudflare Pages/Vercel i rozmawiac z API przez
`REACT_APP_API_URL`.

## Najkrotszy plan na pokaz

1. Neon `DATABASE_URL`.
2. R2 bucket + public URL.
3. Railway API z `deploy/railway-arbor-os.env.example`.
4. `npm run deploy:prod:bootstrap -- --skip-backup`.
5. Cloudflare Pages web z `REACT_APP_API_URL`.
6. Login admina i pokaz sciezki: telefon -> ogledziny -> zdjecia -> zlecenie -> ekipa.
