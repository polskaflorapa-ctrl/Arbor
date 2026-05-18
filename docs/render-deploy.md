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

## 3. Alternative web on Vercel

The root `vercel.json` is ready for Vercel Free.

Set this Vercel environment variable:

```bash
REACT_APP_API_URL=https://<arbor-os-url>.onrender.com/api
```

Then deploy the same GitHub repo in Vercel.

## 4. Mobile app

Expo mobile is not hosted on Render. During mobile builds set:

```bash
EXPO_PUBLIC_API_URL=https://<arbor-os-url>.onrender.com/api
EXPO_PUBLIC_WEB_APP_URL=https://<arbor-web-or-vercel-url>
```

`mobile/constants/api.js` already normalizes URLs with or without `/api`.

## 5. Smoke check

After deploy:

```bash
npm run deploy:free:check -- https://<arbor-os-url>.onrender.com
npm run smoke:render -- https://<arbor-os-url>.onrender.com
```

If Render Free is sleeping, first request may be slow. If `/api/ready` fails,
check `DATABASE_URL` and Render logs.

## Upgrade path

When photos become real production data:

1. Move uploads to Cloudflare R2/Supabase Storage/S3, or
2. Move API to paid Render with a persistent disk, or
3. Move the stack to a VPS.
