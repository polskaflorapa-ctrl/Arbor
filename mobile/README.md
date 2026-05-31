# Arbor Mobile

Aplikacja mobilna Expo/React Native dla zespołu Arbor OS.

## Szybki start

1. Zainstaluj zależności z **korzenia repozytorium** (workspaces `arbor` - jeden `node_modules` i spójne wersje):
   ```bash
   cd ..
   npm install
   cd mobile
   ```
   Samo `npm install` tylko w `mobile/` może dać inne drzewo paczek niż CI / reszta monorepo.
2. Opcjonalnie ustaw adres backendu:
   ```bash
   EXPO_PUBLIC_API_URL=https://twoj-backend.onrender.com
   ```
   Jeśli zmienna nie jest ustawiona, aplikacja użyje domyślnego API produkcyjnego.
3. Uruchom aplikację:
   ```bash
   npm run start
   ```

## Przydatne komendy

- `npm run android` - uruchamia Expo na Androidzie
- `npm run ios` - uruchamia Expo na iOS
- `npm run web` - uruchamia Expo w przeglądarce
- `npm run lint` - uruchamia linting
- `npm run typecheck` - TypeScript bez emisji plików
- `npm run release:check` - sprawdza gotowość release, konfigurację Expo/EAS i smoke gate

## Środowiska release

Profile EAS (`development`, `preview`, `production`) są opisane w dwóch miejscach:

- `eas.json` - wartości używane przez EAS Build.
- `config/release-environments.json` - deklaracja intencji środowisk i oczekiwanych wersji API.

Przed buildem upewnij się, że oba pliki mają te same wartości `EXPO_PUBLIC_API_URL` / `apiUrl` oraz `EXPO_PUBLIC_EXPECTED_API_VERSION` / `expectedApiVersion`. Każde środowisko w `config/release-environments.json` powinno mieć też krótki opis `purpose`.

```bash
npm run release:check
```

Ta komenda sprawdza także domyślny `DEFAULT_API_URL` z `constants/api.js`, publiczną konfigurację Expo, typecheck, lint i mobilne testy smoke.

## Monorepo: React a React Native

**React Native 0.81** (Expo SDK 54) ma wbudowany renderer dopasowany do **React 19.1.0**. Paczka `react` (i `react-dom` tam, gdzie dotyczy) musi być **tej samej minorowej linii** - inaczej pojawia się błąd typu `Incompatible React versions` albo `Invalid hook call`.

W korzeniu repo (`package.json` projektu `arbor`) są **`overrides`**, które wymuszają `react` / `react-dom` **19.1.0** dla całego drzewa npm. Nie podnoś `react` do 19.2.x tylko pod Expo, dopóki RN w tym SDK nie idzie w parze z tą wersją.

Po zmianach w zależnościach:

```bash
cd ..   # korzeń monorepo
npm install
cd mobile
npx expo start --clear
```

## Konfiguracja API

Adres API jest centralnie skonfigurowany w `constants/api.js`.

- Ustaw `EXPO_PUBLIC_API_URL`, aby przełączać środowiska bez edycji kodu.
- `/api` jest dodawane automatycznie, jeśli go brakuje.
- Ustaw `EXPO_PUBLIC_EXPECTED_API_VERSION`, aby diagnostyka mogła ostrzec o niezgodnej wersji backendu.
- Ustaw `EXPO_PUBLIC_WEB_APP_URL`, jeśli linki do panelu web mają prowadzić na inny host niż API.

## Monitoring błędów

- Ustaw `EXPO_PUBLIC_SENTRY_DSN`, aby włączyć Sentry w buildzie mobilnym.
- Opcjonalnie ustaw `EXPO_PUBLIC_SENTRY_ENVIRONMENT` i `EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`.
- Upload sourcemap w EAS jest domyslnie wylaczony w `app.json`, zeby preview build nie wymagal sekretow Sentry. Przed buildem produkcyjnym ustaw `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` i `SENTRY_PROJECT`, polacz projekt Expo z projektem Sentry w EAS/Sentry i wlacz upload w konfiguracji pluginu Sentry.
- Bez DSN aplikacja zostaje przy lokalnym fallbacku w ekranie API Diagnostics.

## Runbook: Funkcje Oddziałów (Admin)

Ten runbook opisuje bezpieczne zarządzanie konfiguracją funkcji oddziałów z poziomu aplikacji.

### Wymagania

- Rola: `Administrator` lub `Dyrektor`
- Dostęp do ekranu: `Dashboard -> Funkcje oddziałów`

### Backup przed zmianami

1. Otwórz `Funkcje oddziałów`.
2. Kliknij `Eksport (kopiuj JSON)`.
3. Wklej payload do pliku, np. `oddzial-config-backup-YYYY-MM-DD.json`.
4. Przechowuj kopię poza repo.

### Standardowa zmiana konfiguracji

1. Wybierz oddział.
2. Ustaw:
   - `name`
   - `mission`
   - `focus`
   - `startPath`
   - `allowed` (dozwolone moduły)
3. Kliknij `Zapisz nadpisanie`.
4. Zweryfikuj:
   - logowanie kontem z tego oddziału
   - start na `startPath`
   - widoczność kafelków i modułów na dashboardzie
   - blokadę wejścia na niedozwolone trasy (redirect na dashboard)

### Import konfiguracji

1. Otwórz `Funkcje oddziałów`.
2. Kliknij `Import JSON`.
3. Wklej zapisany payload.
4. Kliknij `Wykonaj import`.
5. Zweryfikuj logowanie i dostęp do modułów.

### Audit trail

Sekcja audytu pokazuje ostatnie zmiany:

- `set_override`
- `clear_override`
- `import_overrides`

Każdy wpis zawiera czas i aktora zmiany.

### Rollback awaryjny

1. Otwórz `Funkcje oddziałów`.
2. `Import JSON` -> wklej ostatni stabilny backup.
3. `Wykonaj import`.
4. Sprawdź:
   - logowanie
   - `startPath`
   - dostępność modułów oddziału

### Checklist po wdrożeniu

- [ ] `startPath` działa dla testowego konta z każdego zmienionego oddziału
- [ ] Dashboard pokazuje tylko dozwolone funkcje
- [ ] Guard blokuje niedozwolone trasy
- [ ] Eksport i import działają
- [ ] Audit zawiera wpisy po zmianach

## Quick Procedure (1-page)

1. `Dashboard -> Funkcje oddziałów`
2. `Eksport (kopiuj JSON)` i zapisz backup
3. Wybierz oddział i zmień:
   - `startPath`
   - dozwolone moduły (`allowed`)
4. Kliknij `Zapisz nadpisanie`
5. Przetestuj logowanie kontem z tego oddziału
6. Sprawdź audit trail (`set_override`)

Awaryjnie:

1. `Import JSON`
2. Wklej ostatni backup
3. `Wykonaj import`
4. Szybki test logowania + dashboard
