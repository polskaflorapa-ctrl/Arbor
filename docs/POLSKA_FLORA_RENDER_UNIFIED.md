# Polska Flora Render Unified

Cel produkcyjny jest jeden:

- web: https://arbo-web.onrender.com
- API i baza: https://arbor-os-b7k6.onrender.com/api

Ten układ scala aktualny frontend Polska Flora z juz dzialajacym backendem i baza na Renderze. Frontend nie powinien uzywac lokalnego `/api` ani starego builda `ARBOR-OS` w produkcji.

## Konfiguracja

W repo sa ustawione stale wartosci dla obecnego Rendera:

- `render.yaml` i `web/render.yaml`: `VITE_API_URL=https://arbor-os-b7k6.onrender.com/api`
- `deploy/web-production.env.example`: web buduje sie przeciwko temu samemu API.
- `deploy/mobile-production.env.example`: mobile wskazuje to samo API oraz `https://arbo-web.onrender.com`.
- `deploy/render-arbor-os.env.example`: backend dopuszcza `CORS_ORIGINS=https://arbo-web.onrender.com` i ma `PUBLIC_BASE_URL=https://arbor-os-b7k6.onrender.com`.

## Deploy webu

Po zmianach w froncie trzeba zrobic redeploy statycznej uslugi `arbo-web` / `arbor-web` na Renderze. Backend `arbor-os-b7k6` zostaje tym samym backendem i ta sama baza danych zostaje zrodlem prawdy.

Jesli masz deploy hook z Rendera (`arbo-web -> Settings -> Deploy Hook`), ustaw go lokalnie i odpal:

```bash
RENDER_WEB_DEPLOY_HOOK_URL=https://api.render.com/deploy/srv-... npm run deploy:render:web
```

Na Windows PowerShell:

```powershell
$env:RENDER_WEB_DEPLOY_HOOK_URL="https://api.render.com/deploy/srv-..."
npm run deploy:render:web
```

Jesli chcesz od razu poczekac na publiczny smoke po redeployu:

```powershell
$env:RENDER_WEB_DEPLOY_HOOK_URL="https://api.render.com/deploy/srv-..."
npm run deploy:render:web:wait
```

Mozesz wymusic konkretny marker builda, jesli znasz release tag albo krotki SHA:

```powershell
npm run deploy:render:web:wait -- --expected-build abc1234
npm run deploy:render:web:wait -- --expected-build=abc1234 --wait-attempts=30 --wait-interval-ms=10000
```

Przed redeployem:

```bash
npm run verify:render-unified
npm run verify:polska-flora-ready
npm run verify:web
npm run status:production -- --skip-local
```

`status:production` zbiera w jednym raporcie status deploy hooka Render, live smoke
publicznego weba/API oraz lokalny `mobile-release-status`. Status `blocked` oznacza,
ze publiczny web nie jest jeszcze aktualna wersja albo mobile nadal ma produkcyjny
blocker, nawet kiedy lokalny build i lokalne kontrakty przechodza.

Do szybkiej lokalnej diagnostyki bez dotykania publicznego Rendera uzyj:

```bash
npm run status:production -- --skip-remote --skip-slow-local
```

`--skip-local` pomija lokalne kontrakty, ale nadal zostawia `mobile-release-status`.
`--skip-mobile-release-status` jest osobna flaga awaryjna i nie powinna byc uzywana
w production workflow bez swiadomej decyzji ownera. `--skip-remote` pomija deploy hook i live smoke.
Komendy produkcyjne `deploy:render:web`, smoke/status maja `--help`, odrzucaja
nieznane flagi i akceptuja wartosci zarowno jako `--web https://...`, jak i
`--web=https://...`.

Po redeployu:

```bash
npm run deploy:free:check -- https://arbor-os-b7k6.onrender.com
npm run smoke:p95 -- https://arbor-os-b7k6.onrender.com --threshold 500 --samples 5
npm run smoke:render-unified:live
npm run smoke:render-unified:live -- --expected-build abc1234
npm run smoke:render-unified:live -- --web=https://arbo-web.onrender.com --api=https://arbor-os-b7k6.onrender.com/api --any-build
npm run status:production
```

`smoke:render-unified:live`, `deploy:render:web:wait` i `status:production`
domyślnie oczekują markera builda równego aktualnemu krótkiemu SHA z Git.
Dzięki temu stary, ale nadal działający statyczny web nie przejdzie kontroli
po zmianach na `master`. Jeśli chcesz sprawdzić tylko ogólną dostępność web/API
bez porównania wersji, użyj `-- --any-build`.

## Szybka kontrola w przegladarce

Na `https://arbo-web.onrender.com` po redeployu powinny byc widoczne aktualne teksty Polska Flora, m.in. przeplyw:

`Telefon / Ania -> CRM -> Ogledziny -> Wycena -> Ekipa`

Jesli nadal widac stary tytul lub stare teksty `ARBOR-OS`, oznacza to, ze statyczny web nie zostal przebudowany albo Render nadal serwuje poprzedni build.

Ta sama kontrola jest w komendzie:

```bash
npm run smoke:render-unified:live
```

Komenda konczy sie bledem, jesli:

- web zwraca stary marker `ARBOR-OS`,
- web nie ma markerow `Polska Flora`,
- backend `/api/ready/` nie zwraca `status=ready` i `database=up`.
