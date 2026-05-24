# ARBOR free demo deploy

Cel: szybki pokaz dla prezesa bez platnego serwera. Ten wariant uzywa:

- Railway, Koyeb albo lokalny tunel: API `arbor-os`.
- Neon: Postgres.
- Cloudflare R2: zdjecia, szkice i PDF-y.
- Cloudflare Pages, Netlify albo Vercel: web `arbor-web`.

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

## 4. Koyeb API alternatywnie

Koyeb pozwala wdrozyc `os/` jako web service Node/Express. Uzyj katalogu roboczego
`os/`, procesu `web: npm start` z `os/Procfile` i zmiennych z:

```text
deploy/koyeb-arbor-os.env.example
```

Najwazniejsze wartosci:

```text
DATABASE_URL=postgresql://<user>:<password>@<neon-pooler-host>/<db>?sslmode=require
CORS_ORIGINS=https://<arbor-web>.netlify.app
PUBLIC_BASE_URL=https://<arbor-os>.koyeb.app
```

Lokalny check konfiguracji:

```powershell
npm run deploy:koyeb:check
```

Po wdrozeniu:

```powershell
npm run deploy:koyeb:check -- https://<arbor-os>.koyeb.app
```

## 5. Pierwszy admin i demo dane

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

Na szybki pokaz, jesli `pg_dump` nie jest jeszcze zainstalowany, od razu
wstaw tez dane pokazowe dla prezesa:

```powershell
npm run deploy:prod:bootstrap -- --seed-demo --skip-backup
```

Docelowo, z PostgreSQL client tools:

```powershell
npm run deploy:prod:bootstrap
```

Same dane demo mozna dosiac osobno:

```powershell
npm run seed:president-demo
```

Wszyscy uzytkownicy `demo_*` dostaja domyslne haslo `Demo123!ARBOR`.
Mozesz zmienic je przed seedem:

```powershell
$env:DEMO_PASSWORD="<inne-haslo-do-pokazu>"
npm run seed:president-demo
```

## 6. Cloudflare Pages web

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

## 7. Netlify alternatywnie

Repo ma juz `netlify.toml`. Netlify powinien wykryc:

```text
Base directory: web
Build command: npm ci && npm run build
Publish directory: build
```

Ustaw zmienna:

```text
REACT_APP_API_URL=https://<arbor-os>.up.railway.app/api
```

Lokalny check przed deployem:

```powershell
npm run deploy:netlify:check -- https://<arbor-os>.up.railway.app
```

## 8. Vercel alternatywnie

Repo ma juz `vercel.json`.

Ustaw:

```text
REACT_APP_API_URL=https://<arbor-os>.up.railway.app/api
```

Output jest `web/build`.

## 9. Finalny smoke

Po stworzeniu admina:

```powershell
$env:SMOKE_LOGIN="admin"
$env:SMOKE_PASSWORD="<same-password-used-for-bootstrap>"
npm run smoke:render -- https://<arbor-os>.up.railway.app
```

Web powinien logowac sie przez Cloudflare Pages / Netlify / Vercel i rozmawiac
z API przez `REACT_APP_API_URL`.

## Najkrotszy plan na pokaz

1. Neon `DATABASE_URL`.
2. R2 bucket + public URL.
3. Railway API z `deploy/railway-arbor-os.env.example` albo Koyeb API z `deploy/koyeb-arbor-os.env.example`.
4. `npm run deploy:prod:bootstrap -- --seed-demo --skip-backup`.
5. Cloudflare Pages / Netlify / Vercel web z `REACT_APP_API_URL`.
6. Login admina i pokaz sciezki: telefon -> ogledziny -> zdjecia -> zlecenie -> ekipa.
