# Arbor Mobile

Aplikacja mobilna Expo/React Native dla zespołu Arbor OS.

## Szybki start

1. Zainstaluj zależności z **korzenia repozytorium** (workspaces `arbor` — jeden `node_modules` i spójne wersje):
   ```bash
   cd ..
   npm install
   cd mobile
   ```
   Samo `npm install` tylko w `mobile/` może dać inne drzewo paczek niż CI / reszta monorepo.
2. (Opcjonalnie) ustaw adres backendu:
   ```bash
   EXPO_PUBLIC_API_URL=https://twoj-backend.onrender.com
   ```
   Jeśli zmienna nie jest ustawiona, aplikacja użyje domyślnego API produkcyjnego.
   Możesz skopiować `.env.example` do `.env` i podmienić wartość.
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

## Monorepo: React a React Native

**React Native 0.81** (Expo SDK 54) ma wbudowany renderer dopasowany do **React 19.1.0**. Paczka `react` (i `react-dom` tam, gdzie dotyczy) musi być **tej samej minorowej linii** — inaczej pojawia się błąd typu *Incompatible React versions* albo *Invalid hook call*.

W korzeniu repo (`package.json` projektu `arbor`) są **`overrides`**, które wymuszają `react` / `react-dom` **19.1.0** dla całego drzewa npm — **nie podnoś** `react` do 19.2.x tylko pod Expo, dopóki RN w tym SDK nie idzie w parze z tą wersją.

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

## Runbook: Funkcje Oddzialow (Admin)

Ten runbook opisuje bezpieczne zarzadzanie konfiguracja funkcji oddzialow z poziomu aplikacji.

### Wymagania

- Rola: `Administrator` lub `Dyrektor`
- Dostep do ekranu: `Dashboard -> Funkcje oddzialow`

### Backup przed zmianami

1. Otworz `Funkcje oddzialow`.
2. Kliknij `Eksport (kopiuj JSON)`.
3. Wklej payload do pliku, np. `oddzial-config-backup-YYYY-MM-DD.json`.
4. Przechowuj kopie poza repo.

### Standardowa zmiana konfiguracji

1. Wybierz oddzial.
2. Ustaw:
   - `name`
   - `mission`
   - `focus`
   - `startPath`
   - `allowed` (dozwolone moduły)
3. Kliknij `Zapisz nadpisanie`.
4. Zweryfikuj:
   - logowanie kontem z tego oddzialu
   - start na `startPath`
   - widocznosc kafelkow i modulow na dashboardzie
   - blokade wejscia na niedozwolone trasy (redirect na dashboard)

### Import konfiguracji

1. Otworz `Funkcje oddzialow`.
2. Kliknij `Import JSON`.
3. Wklej zapisany payload.
4. Kliknij `Wykonaj import`.
5. Zweryfikuj logowanie i dostep do modulow.

### Audit trail

Sekcja audytu pokazuje ostatnie zmiany:

- `set_override`
- `clear_override`
- `import_overrides`

Kazdy wpis zawiera czas i aktora zmiany.

### Rollback (awaryjny)

1. Otworz `Funkcje oddzialow`.
2. `Import JSON` -> wklej ostatni stabilny backup.
3. `Wykonaj import`.
4. Sprawdz:
   - logowanie
   - `startPath`
   - dostepnosc modulow oddzialu

### Checklist po wdrozeniu

- [ ] `startPath` dziala dla testowego konta z kazdego zmienionego oddzialu
- [ ] Dashboard pokazuje tylko dozwolone funkcje
- [ ] Guard blokuje niedozwolone trasy
- [ ] Eksport i import dzialaja
- [ ] Audit zawiera wpisy po zmianach

## Quick Procedure (1-page)

1. `Dashboard -> Funkcje oddzialow`
2. `Eksport (kopiuj JSON)` i zapisz backup
3. Wybierz oddzial i zmien:
   - `startPath`
   - dozwolone moduly (`allowed`)
4. Kliknij `Zapisz nadpisanie`
5. Przetestuj logowanie kontem z tego oddzialu
6. Sprawdz audit trail (`set_override`)

Awaryjnie:

1. `Import JSON`
2. Wklej ostatni backup
3. `Wykonaj import`
4. Szybki test logowania + dashboard
