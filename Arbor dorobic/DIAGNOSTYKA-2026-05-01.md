# Diagnostyka projektów Arbor — 2026-05-01

Skanowane: `C:\Users\paha1\arbor\mobile` (Expo / RN) oraz `C:\Users\paha1\arbor\os` (Node/Express). Sandbox bash był niedostępny, więc nie odpalałem `tsc` / `eslint` / `jest` — diagnostyka jest statyczna (Read/Grep/Glob).

## Co zostało naprawione w tej sesji

1. **`mobile/babel.config.js`** — dodany `react-native-worklets/plugin` (musi być ostatni). Bez niego Reanimated 4 + nowa architektura w SDK 54 wywalają animacje w runtime. To było realne ryzyko crashu na produkcji.
2. **`os/src/routes/kommoQuotationWebhook.js`** — `checkSecret()` przepisany na **fail-closed** (brak `KOMMO_QUOTATION_WEBHOOK_SECRET` = odrzucenie zamiast przepuszczenia) + porównanie w stałym czasie (`crypto.timingSafeEqual`), żeby zatkać timing attack. Wcześniej przy pustej zmiennej środowiskowej webhook publicznie wpuszczał INSERT do `quotations`.
3. **`mobile/package.json`** — `lodash: ^4.18.1` (wersja nieistniejąca, ostatnia stabilna to 4.17.21) → `^4.17.21`.

## Co znalezione, ale NIE ruszone (wymaga twojej decyzji)

### Mobile

- **Martwy kod z templatki `create-expo-app`** (~14 plików): `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/explore.tsx`, `app/modal.tsx`, `components/{external-link,hello-wave,parallax-scroll-view,themed-text,themed-view}.tsx`, `components/ui/{collapsible,icon-symbol,icon-symbol.ios}.tsx`, `hooks/{use-color-scheme,use-color-scheme.web,use-theme-color}.ts`. Krytyczne: `(tabs)/_layout.tsx` rejestruje `Tabs.Screen` dla plików których w `(tabs)/` nie ma. Nie usuwałem bo skasowanie kodu wymaga twojej zgody.
- **Hardkodowane polskie stringi w `app/dashboard.tsx`** (linie ~163-202) — bypassują i18n, UK/RU nie zadziała na tych etykietach.
- **Połknięte błędy sieci** w `app/dashboard.tsx:99`, `app/zlecenie/[id].tsx:178-180`, `app/pomocnik.tsx:30` — `catch { /* ignoruj */ }` bez ustawienia stanu błędu.
- **78 użyć `any`** w 18 plikach `app/` — głównie `useState<any>(null)` na user/task/zlecenie. Brak ochrony przy dostępie do pól.
- **Brak `android.package` i `ios.bundleIdentifier`** w `app.json` — EAS build nie przejdzie.
- **Nieużywane / zbędne deps**: `pdfkit` (czysto Node, nigdzie nie importowany w TS), `@types/react-native` (od RN 0.71 typy są w samym pakiecie, wersja 0.72 daje konflikty), `axios` używany TYLKO w jednym pliku — reszta używa `fetch`.

### OS / backend

- **Brak walidacji Zod** na publicznym endpoint'cie `POST /api/public/quotations/:token/choice` (akceptacja oferty) i na większości `POST/PATCH` w `routes/crm.js`. Wszystkie przyjmują surowe `req.body`.
- **`package.json`** — dziwne wersje:
  - `eslint: ^10.2.1` i `@eslint/js: ^10.0.1` — ESLint nie ma majora 10. `npm install` może wybuchnąć.
  - `express: ^5.2.1` — sprawdź w npm registry, czy nie literówka. (`^5` i tak złapie 5.x.)
  - `"main": "index.js"` — taki plik nie istnieje, entry to `src/server.js`.
- **`loginAttempts = new Map()`** w `routes/auth.js:19` — limiter w pamięci, nie przeżyje restartu, nie skaluje się na wielu instancjach.
- **`app.set('trust proxy', …)` brakuje w `app.js`** — przez to wszystkie rate-limitery widzą IP reverse proxy, nie klienta. Jeden bucket dla wszystkich.
- **`/api/db-test` i `/api/metrics` bez auth** — wycieka dostępność DB / metryki Prom-client. W prod wyłączyć lub zabezpieczyć.
- **`src/server.js:24`** — duplikowany `require('./routes/tasks')` z wywołaniem niezadeklarowanego `runMigration`. Sprawdzić czy nie no-op.

## Co NIE jest błędem (subagent się mylił)

- **`model: 'claude-opus-4-6'`** w `routes/ai.js` (linie 78, 121, 231) i `services/phone-call-pipeline.js:185` — to jest **prawidłowy, aktualny identyfikator** modelu Anthropic (Claude Opus 4.6). NIE zmieniaj.

## Czego NIE udało się zrobić

- Nie odpaliłem `tsc --noEmit`, `eslint`, `jest` — Linux sandbox bash nie wstał. Po zmianach które wprowadziłem warto u siebie odpalić ręcznie:
  - `cd mobile && npm run typecheck && npm run lint`
  - `cd os && npm test && npm run lint`
- Nie testowałem zmian runtime'owo (brak Node w środowisku).

## Sugerowana kolejność dalszych działań

1. Odpalić `npm install` w `mobile/` po naprawie wersji `lodash` — sprawdzić czy wszystko schodzi.
2. Odpalić `expo start --clear` żeby Metro/Babel złapał nowy plugin worklets.
3. Zweryfikować/poprawić wersje ESLint w `os/package.json` zanim ktoś odpali `npm install`.
4. Decyzja o usunięciu martwego kodu z templatki Expo (~14 plików) — daj znać, dokończę.
5. Decyzja o `app.set('trust proxy', 1)` w `os/src/app.js` — jeśli stoisz za Render/Cloudflare, to konieczne.
