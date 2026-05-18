# ARBOR free deploy

This repo is configured for a free-first deployment:

- `arbor-os` on Render Free.
- `arbor-web` on Render Static or Vercel Free.
- PostgreSQL on Neon Free.

## Important limitation

Render Free has an ephemeral filesystem. Local uploads can disappear after a
restart or redeploy. This is OK for early testing, but field photos and sketches
must move to Cloudflare R2, Supabase Storage, S3, or a paid host before daily
company use.

## 1. Create Neon Free database

1. Create a Neon project.
2. Open `Connect` and enable/use the pooled connection string (`-pooler` in the host).
3. Keep it for Render as `DATABASE_URL`.

Before clicking deploy, run locally:

```bash
npm run deploy:free:check
```

## 2. Deploy API + web on Render

1. Push branch `master` to GitHub.
2. In Render choose `New -> Blueprint`.
3. Select `polskaflorapa-ctrl/Arbor`.
4. Use root `render.yaml`.
5. Render will create:
   - `arbor-os` as a free Node service,
   - `arbor-web` as a static site.
6. In `arbor-os -> Environment`, set:
   - `DATABASE_URL=<your Neon connection string>`.
7. Optional after `arbor-web` gets its URL:
   - set `CORS_ORIGINS=https://<arbor-web>.onrender.com`.

The web service gets `REACT_APP_API_URL` automatically from `arbor-os`.

## 3. Create first production admin

After the database migration runs, create the first login locally against Neon.
Do not commit the password and do not paste it into this file.

PowerShell:

```powershell
$env:DATABASE_URL="postgresql://<user>:<password>@<neon-pooler-host>/<db>?sslmode=require"
$env:BOOTSTRAP_ADMIN_LOGIN="admin"
$env:BOOTSTRAP_ADMIN_PASSWORD="<long-random-password>"
$env:BOOTSTRAP_ADMIN_EMAIL="biuro@example.com"
$env:BOOTSTRAP_ADMIN_ROLE="Administrator"
$env:BOOTSTRAP_ADMIN_BRANCH_NAME="Centrala"

npm run db:migrate -w arbor-os
npm run bootstrap:admin -w arbor-os
```

The script creates or updates one active user and never prints the password.
Use it again only when you intentionally want to reset that admin password.

## 4. Alternative web on Vercel

The root `vercel.json` is ready for Vercel Free.

Set this Vercel environment variable:

```bash
REACT_APP_API_URL=https://<arbor-os-url>.onrender.com/api
```

Then deploy the same GitHub repo in Vercel.

## 5. Mobile app

Expo mobile is not hosted on Render. During mobile builds set:

```bash
EXPO_PUBLIC_API_URL=https://<arbor-os-url>.onrender.com/api
EXPO_PUBLIC_WEB_APP_URL=https://<arbor-web-or-vercel-url>
```

`mobile/constants/api.js` already normalizes URLs with or without `/api`.

## 6. Smoke check

After deploy:

```bash
npm run deploy:free:check -- https://<arbor-os-url>.onrender.com
npm run smoke:render -- https://<arbor-os-url>.onrender.com
```

Authenticated smoke check after creating the first admin:

```powershell
$env:SMOKE_LOGIN="admin"
$env:SMOKE_PASSWORD="<same-password-used-for-bootstrap>"
npm run smoke:render -- https://<arbor-os-url>.onrender.com
```

If Render Free is sleeping, first request may be slow. If `/api/ready` fails,
check `DATABASE_URL` and Render logs.

## Upgrade path

When photos become real production data:

1. Move uploads to Cloudflare R2/Supabase Storage/S3, or
2. Move API to paid Render with a persistent disk, or
3. Move the stack to a VPS.
