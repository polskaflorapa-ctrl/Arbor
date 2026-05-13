# Diagnostyka projektów Arbor — 2026-05-01

Skanowane: `C:\Users\paha1\arbor\mobile` (Expo / RN) oraz `C:\Users\paha1\arbor\os` (Node/Express). Sandbox bash był niedostępny, więc nie odpalałem `tsc` / `eslint` / `jest` — diagnostyka jest statyczna (Read/Grep/Glob).

## Wszystkie zmiany wprowadzone w tej sesji

### Mobile (`C:\Users\paha1\arbor\mobile`)

1. **`babel.config.js`** — dodany `react-native-worklets/plugin` (ostatni w kolejności). Bez niego Reanimated 4 + nowa architektura w SDK 54 wywalają animacje w runtime.
2. **`package.json`** — `lodash` poprawiony na `^4.17.21` (poprzednia `^4.18.1` nie istnieje). Dodatkowo (już zrobione przed moją edycją albo przez Ciebie) usunięte `pdfkit` i `@types/react-native`.
3. **`app.json`** — dodane `ios.bundleIdentifier` i `android.package` = `com.arbor.mobile`. **WAŻNE**: jeśli docelowo masz inny scheme (np. `com.firma.arbor`), zmień teraz przed pierwszym buildem EAS — po publikacji w sklepach zmiana = nowa aplikacja.
4. **`app/modal.tsx`** — przepisany na 3-linijkowy `<Redirect href="/" />`. Wcześniej importował `themed-text`/`themed-view` z templatki `create-expo-app` — choć by się nie wywalił, był martwym ekranem.

### Backend OS (`C:\Users\paha1\arbor\os`)

1. **`src/routes/kommoQuotationWebhook.js`** — `checkSecret()` przepisany na **fail-closed** (brak `KOMMO_QUOTATION_WEBHOOK_SECRET` = odrzucenie zamiast przepuszczenia) + porównanie w stałym czasie (`crypto.timingSafeEqual`), żeby zatkać timing attack. Wcześniej przy pustej zmiennej środowiskowej webhook publicznie wpuszczał INSERT do `quotations`.
2. **`src/app.js`** — dodane:
   - `app.set('trust proxy', …)` przy starcie. Sterowanie przez ENV `TRUST_PROXY` (numer / "true" / "false"), a w `NODE_ENV=production` domyślnie `1`. Bez tego express-rate-limit i `req.ip` widzą IP reverse-proxy (Render/Cloudflare/nginx), nie klienta — wszystkie requesty trafiają do jednego bucketa.
   - `/api/db-test` w produkcji wymaga JWT (przez `authMiddleware`). Sterowanie przez `DB_TEST_REQUIRE_AUTH=true` w dev.
   - `/api/metrics` wymaga tokena `METRICS_TOKEN` (header `Authorization: Bearer <token>` lub `?token=`). Brak tokena + prod = 401.
3. **`src/routes/quotation-public.js`** + **`src/schemas/quotation-public.js`** — dodana walidacja Zod na publicznym endpoint'cie `POST /api/public/quotations/:token/choice` (akceptacja oferty przez klienta) oraz `GET /api/public/quotations/:token`. Token musi pasować do regex `[A-Za-z0-9_\-]{8,128}`, action ∈ `{accept,reject}`. Przedtem surowy `req.body` szedł prosto do logiki bazodanowej.
4. **`package.json`** — naprawione nieistniejące wersje `eslint ^10.x` → `^9.25.0`, `@eslint/js ^10.0.1` → `^9.18.0`, `globals ^17.5.0` → `^15.14.0`. `npm install` by wywalał. Dodane `engines.node: ">=20.0.0"`. Pole `main` poprawione z fikcyjnego `index.js` na `src/server.js`.

## Co znalezione, ale NIE ruszone (wymaga twojej decyzji)

### Wymaga twojej akcji ręcznej (nie miałem narzędzia do `rm`)

Te pliki to martwa templatka `create-expo-app`. Nie są importowane przez żaden żywy plik (zweryfikowane Grepem) — można bezpiecznie skasować:

```
mobile/components/external-link.tsx
mobile/components/hello-wave.tsx
mobile/components/parallax-scroll-view.tsx
mobile/components/themed-text.tsx
mobile/components/themed-view.tsx
mobile/components/ui/collapsible.tsx
mobile/components/ui/icon-symbol.tsx
mobile/components/ui/icon-symbol.ios.tsx
mobile/hooks/use-color-scheme.ts
mobile/hooks/use-color-scheme.web.ts
mobile/hooks/use-theme-color.ts
```

PowerShell jednolinijkowiec:

```powershell
Remove-Item -Path C:\Users\paha1\arbor\mobile\components\external-link.tsx,C:\Users\paha1\arbor\mobile\components\hello-wave.tsx,C:\Users\paha1\arbor\mobile\components\parallax-scroll-view.tsx,C:\Users\paha1\arbor\mobile\components\themed-text.tsx,C:\Users\paha1\arbor\mobile\components\themed-view.tsx,C:\Users\paha1\arbor\mobile\components\ui\collapsible.tsx,C:\Users\paha1\arbor\mobile\components\ui\icon-symbol.tsx,C:\Users\paha1\arbor\mobile\components\ui\icon-symbol.ios.tsx,C:\Users\paha1\arbor\mobile\hooks\use-color-scheme.ts,C:\Users\paha1\arbor\mobile\hooks\use-color-scheme.web.ts,C:\Users\paha1\arbor\mobile\hooks\use-theme-color.ts
```

**UWAGA:** subagent rekomendował też usunąć `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/explore.tsx` — sprawdziłem ręcznie, te pliki mają **realny kod** (session check + ekran Raporty). NIE kasować.

### Niezrobione, świadomie odłożone

- **Hardkodowane PL stringi w `app/dashboard.tsx`** (linie ~163-202) — bypassują i18n (UK/RU nie zadziała).
- **Połknięte błędy sieci** w `app/dashboard.tsx:99`, `app/zlecenie/[id].tsx:178-180`, `app/pomocnik.tsx:30` — `catch { /* ignoruj */ }` bez stanu błędu.
- **78 użyć `any`** w 18 plikach `app/` — głównie `useState<any>(null)`.
- **Brak walidacji Zod na `routes/crm.js`** — POST `/leads`, PATCH `/leads/:id`, POST `/activities` itd. Body parsowane ręcznie. Nie ruszałem bo to ~500 linii i wymaga zaprojektowania ~10 schematów.
- **`loginAttempts = new Map()`** w `routes/auth.js:19` — limiter w pamięci, nie przeżyje restartu, nie skaluje na wielu instancjach (potrzebny Redis dla skali).
- **`src/server.js:24`** — duplikowany `require('./routes/tasks')` z wywołaniem niezadeklarowanego `runMigration`.
- **`axios` w mobile** — używany tylko w `app/raport-dzienny.tsx:1`, reszta projektu używa `fetch`. Można usunąć po małym refaktorze.

## Co NIE jest błędem (subagent się mylił)

- **`model: 'claude-opus-4-6'`** w `routes/ai.js` (linie 78, 121, 231) i `services/phone-call-pipeline.js:185` — to jest **prawidłowy, aktualny identyfikator** modelu Anthropic (Claude Opus 4.6). NIE zmieniaj.
- **`app/(tabs)/index.tsx` i `(tabs)/explore.tsx`** — subagent oznaczył jako templatkę, ale są to żywe ekrany z biznesową logiką (session check, ekran Raporty z KPI).

## Czego NIE udało się zrobić

- Nie odpaliłem `tsc --noEmit`, `eslint`, `jest` — Linux sandbox bash nie wstał. Po zmianach które wprowadziłem **odpal u siebie**:
  - `cd mobile && npm install && npm run typecheck && npm run lint`
  - `cd os && npm install && npm test && npm run lint`
- Nie skasowałem martwych plików — nie mam tool'a `rm` w tej sesji. Zobacz one-liner powyżej.
- Nie testowałem zmian runtime'owo (brak Node w środowisku).

## Sugerowana kolejność dalszych działań

1. **Najpierw**: skasuj martwe pliki templatki (one-liner powyżej).
2. **Mobile**: `cd mobile && npm install` — sprawdź czy zejście wersji się powiedzie. Potem `expo start --clear` żeby Metro/Babel złapał nowy plugin worklets.
3. **OS**: `cd os && npm install` — zweryfikuj nowe wersje ESLint. Potem `npm test` i `npm run lint`.
4. **Konfiguracja produkcyjna OS** — ustaw w prod ENV:
   - `TRUST_PROXY=1` (lub konkretną liczbę hopów)
   - `METRICS_TOKEN=<silny losowy ciąg>` (jeśli używasz `METRICS_ENABLED=true`)
   - `KOMMO_QUOTATION_WEBHOOK_SECRET=<silny losowy ciąg>` — bez tego webhook teraz odrzuca wszystko
5. **Bundle ID** — zweryfikuj `com.arbor.mobile` w `app.json`. Jeśli inny scheme — zmień teraz.
6. **Zostaje do decyzji**: Zod na `routes/crm.js`, Redis na limiter logowania, refactor `any → typy` w mobile.
