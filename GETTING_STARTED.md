# Arbor-OS — Przewodnik Szybkiego Startu

Dokumentacja dla deweloperów i testerów ARBOR-OS.

## 🚀 Szybki Start (Dev Mode)

### Warunki wstępne

- **Node.js** 18+
- **npm** 9+
- **Git**
- **Docker** (opcjonalnie, do stacku bazy danych)

### 1. Instalacja zależności

```powershell
cd C:\Users\paha1\arbor
npm install
```

### 2. Konfiguracja środowiska

Skopiuj przykładowe pliki `.env`:

```powershell
# Web
cp web\.env.example web\.env

# OS (Backend)
cp os\.env.example os\.env

# Mobile (większość ustawień z root)
```

### 3. Uruchomienie trybów deweloperskich

#### Opcja A: Wszystko naraz (Web + API + OS)

```powershell
npm run dev:all
```

To uruchomi równocześnie:
- Web (http://localhost:3000)
- API (http://localhost:3001)
- OS backend (jeśli skonfigurowany)

#### Opcja B: Poszczególne aplikacje

```powershell
# Terminal 1: Web
npm run dev:web

# Terminal 2: API
npm run dev:api

# Terminal 3: Mobile (Expo)
npm run dev:mobile

# Terminal 4: OS backend (jeśli potrzebujesz)
npm run dev:os
```

### 4. Test Mode — Szybka Demonstracja

Jeśli nie chcesz konfigurować backendu, użyj **Test Mode**:

```powershell
npm run dev:web
```

Następnie w przeglądarce:
- Naciśnij **Ctrl+Shift+D**
- Zaznacz "Włącz tryb testowy"
- Wybierz rolę i testuj bez backendu

Pełny przewodnik: [TEST_MODE_GUIDE.md](./TEST_MODE_GUIDE.md)

## 📋 Struktura Projektu

```
arbor/
├── web/              # React Frontend (Create React App)
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── utils/    # testMode.js, api.js
│   │   └── api.js    # Axios HTTP client
│   └── package.json
│
├── mobile/           # React Native (Expo)
│   ├── app/          # Expo Router screens
│   ├── utils/        # testMode.ts
│   ├── hooks/        # useTestMode.ts
│   └── package.json
│
├── os/               # Node.js Backend (Express)
│   ├── src/
│   │   ├── routes/   # API endpoints
│   │   ├── services/
│   │   └── server.js
│   ├── tests/
│   └── package.json
│
└── package.json      # Root workspace config
```

## 🧪 Test Mode

### Co to jest?

Tryb testowy umożliwia testowanie aplikacji **bez połączenia z backendem**. Mock'uje API, zwracając sztucznie przygotowane dane.

### Dla Web

**Włączenie:**
- Ctrl+Shift+D → Dev Panel → włącz tryb testowy

**Testowi użytkownicy:**
- Dyrektor (wszystkie oddziały)
- Kierownik (Oddział 2)
- Brygadzista (Oddział 2, Ekipa 5)
- Wyceniający (Oddział 1)

**Mockowane endpointy:**
- `GET /zlecenia` → test zlecenia
- `GET /oddzialy` → test oddziały
- `GET /ekipy` → test ekipy
- `GET /wyceny` → test wyceny
- `POST /auth/login` → test token

### Dla Mobile

**Włączenie:**
- Profil → tapnij 7x na awatar → Test Mode → włącz toggle

**Hook `useTestMode()`:**
```typescript
const { isEnabled, mockData } = useTestMode();
```

Pełny przewodnik: [TEST_MODE_GUIDE.md](./TEST_MODE_GUIDE.md)

## 🔍 Weryfikacja Projektu

### Build i Testy

```powershell
# Web: build + testy
cd web
npm run verify

# Mobile: lint + typecheck
cd ../mobile
npm run lint
npm run typecheck

# OS: lint + testy
cd ../os
npm run lint
npm test -- --runInBand
```

### Status

```powershell
cd ..
npm run status          # szybki podgląd (porty, health)
npm run health          # pełna diagnostyka
npm run status:json:strict  # ścisła weryfikacja (wymaga uruchomionych serwisów)
```

## 📚 Dostępne Skrypty (Root)

```bash
npm run dev              # Dev mode z inteligentnym wyborem
npm run dev:all          # Web + API + OS jednocześnie
npm run dev:web          # Tylko Web (port 3000)
npm run dev:mobile       # Tylko Mobile/Expo
npm run dev:os           # Tylko OS backend
npm run dev:api          # Tylko API server

npm run build            # Production build (Web + sync)
npm run health           # Health check
npm run status           # Status wszystkich serwisów
npm run doctor           # Diagnostyka i rekomendacje

npm run up               # Uruchom Docker stack (baza danych)
npm run down             # Zatrzymaj Docker stack
npm run restart:force    # Restart z wymuszonym przebudo
```

## 🐛 Rozwiązywanie Problemów

### Web Dev Panel nie pojawia się

1. Naciśnij F12 → Console
2. Wpisz: `localStorage.setItem('arbor-test-mode', 'true'); location.reload();`
3. Jeśli to nie pomaga, sprawdź `web/src/components/DevPanel.js`

### Mobile Test Mode nie działa

1. Sprawdź czy `/mobile/app/test-mode.tsx` jest dostępny
2. Tapnij dokładnie 7 razy na awatar w Profilu
3. Jeśli dalej nie działa, sprawdź `mobile/app/profil.tsx` linię ~59

### API Mocks zwracają null

1. Sprawdź endpoint w `web/src/utils/testMode.js` (`getMockData()`)
2. Jeśli endpointu tam niego, dodaj nowy case w switch:
   ```javascript
   '/nowy-endpoint': MOCK_DATA.nowy_endpoint,
   ```
3. Przeładuj stronę

### OS Backend nie startuje

```powershell
# Sprawdź czy baza danych działa
npm run db:logs

# Jeśli nie, uruchom docker stack
npm run up
npm run dev:os
```

## 🚢 Przygotowanie do Deployment

### Build na Production

```powershell
# Web
cd web
npm run build

# Sprawdź build
npm run preview
```

### Checklist Pre-Release

- [ ] `npm run verify` w `web/` przeszło
- [ ] `npm run lint && npm run typecheck` w `mobile/` przeszły
- [ ] `npm run lint && npm test` w `os/` przeszły
- [ ] `npm run status:json:strict` zwraca OK
- [ ] Test mode działa w obu aplikacjach
- [ ] Wszystkie mock'i API są poprawne
- [ ] Dokumentacja TEST_MODE_GUIDE.md jest aktualna
- [ ] Environment variables są ustawione
- [ ] CHANGELOG.md zawiera wszystkie zmiany

## 📞 Kontakt i Support

Jeśli napotkasz problemy:
1. Sprawdź logs: `npm run health`
2. Zaglądnij do [TEST_MODE_GUIDE.md](./TEST_MODE_GUIDE.md)
3. Sprawdź DIAGNOSTYKA pliki (jeśli istnieją)
4. Skontaktuj się z zespołem backend

## 📄 Dodatkowe Dokumenty

- **[TEST_MODE_GUIDE.md](./TEST_MODE_GUIDE.md)** — Pełny przewodnik trybu testowego
- **[MONOREPO-SETUP.md](./MONOREPO-SETUP.md)** — Konfiguracja monorepo
- **[CHANGELOG.md](./CHANGELOG.md)** — Historia zmian

## Environment Runbook

- **[docs/ENVIRONMENT-RUNBOOK.md](./docs/ENVIRONMENT-RUNBOOK.md)** - konfiguracja `.env`, Kommo, Zadarma, publicznych linkow i wdrozen
