# 🛠️ Tryb Testowy - Przewodnik

Dokumentacja dla trybu testowego w aplikacjach Web i Mobile ARBOR-OS.

## Przegląd

Tryb testowy pozwala na:
- ✅ Testowanie aplikacji bez połączenia z backendem
- ✅ Symulacja roli użytkownika (Dyrektor, Kierownik, Brygadzista, Wyceniający)
- ✅ Mockowanie danych API
- ✅ Testowanie UI bez konieczności konfiguracji środowiska
- ✅ Demonstracja funkcjonalności potencjalnym klientom

## Web Aplikacja

### Włączenie Trybu Testowego

#### Metoda 1: Dev Panel (Ctrl+Shift+D)

1. Naciśnij **Ctrl+Shift+D** (lub Cmd+Shift+D na macOS)
2. W prawym dolnym rogu pojawi się ukryty panel
3. Zaznacz "Włącz tryb testowy"
4. Wybierz rolę testowego użytkownika
5. Aplikacja się przeładuje i zaloguje testowego użytkownika

#### Metoda 2: Zmienna Środowiskowa

W pliku `.env`:
```
REACT_APP_TEST_MODE=true
```

Następnie uruchom: `npm start`

### Testowi Użytkownicy

| Rola | Email | Oddziały |
|------|-------|----------|
| Dyrektor | dyrektor@test.local | Wszystkie |
| Kierownik | kierownik@test.local | Oddział 2 |
| Brygadzista | brygadzista@test.local | Oddział 2, Ekipa 5 |
| Wyceniający | wyceniajacy@test.local | Oddział 1 |

### Mockowane Dane

Kada rola ma dostęp do:
- **Zlecenia**: 2 testowe zlecenia (Nowe, W realizacji)
- **Oddziały**: 2 oddział (Warszawa, Kraków)
- **Ekipy**: 1 ekipa testowa
- **Wyceny**: 1 testowa wycena

### Modyfikacja Mockowych Danych

Plik: `web/src/utils/testMode.js`

```javascript
export const MOCK_DATA = {
  zlecenia: [...],
  oddzialy: [...],
  ekipy: [...],
  wyceny: [...],
};
```

## Mobile Aplikacja

### Włączenie Trybu Testowego

#### Metoda 1: Hidden Dev Panel (Tap 7 razy na awatarze)

1. Przejdź do ekranu **Profil**
2. Tapnij 7 razy na awatar (okrąg z inicjałami w górze)
3. Otworzysz się ekran **Tryb Testowy**
4. Zaznacz toggle "Status trybu testowego"
5. Wybierz rolę z listy
6. Aplikacja się przeładuje

#### Metoda 2: Bezpośredni Dostęp

Przejdź do: `/test-mode` (jeśli masz dostęp routera)

### Testowi Użytkownicy (Mobile)

Tak samo jak w web aplikacji:
- Dyrektor, Kierownik, Brygadzista, Wyceniający
- Email i dane kontaktowe identyczne

### Mockowane Dane (Mobile)

Plik: `mobile/utils/testMode.ts`

```typescript
export const MOCK_DATA_MOBILE = {
  zlecenia: [...],
  dashboard: {...},
};
```

### Hook `useTestMode()`

Użyj w komponentach:

```typescript
import { useTestMode } from '../hooks/useTestMode';

export default function MyComponent() {
  const { isEnabled, isLoading } = useTestMode();
  
  if (isLoading) return <Text>Ładowanie...</Text>;
  
  return (
    <Text>
      Test Mode: {isEnabled ? 'WŁĄCZONY' : 'WYŁĄCZONY'}
    </Text>
  );
}
```

### Mockowanie API Requestów

Plik: `mobile/hooks/useTestMode.ts`

```typescript
import { apiCallWithTestMode } from '../hooks/useTestMode';

const data = await apiCallWithTestMode('/zlecenia');
```

## Bezpieczeństwo

⚠️ **WAŻNE**:
- Tryb testowy **NIE POWINIEN** być dostępny w wersji produkcyjnej
- Waliduj zmienne środowiskowe build-time
- W produkcji env var `REACT_APP_TEST_MODE` powinna być `false` lub nieistniejąca

### Production Build

```bash
# Pewne że test mode jest wyłączony
REACT_APP_TEST_MODE=false npm run build

# Lub bez zmiennej (domyślnie false)
npm run build
```

## Development vs Production

### Development (npm start / npm run dev)
- Tryb testowy dostępny via Ctrl+Shift+D (web) lub 7-tap (mobile)
- localStorage/AsyncStorage mogą zawierać test mode ustawienia

### Production (npm run build)
- Tryb testowy niedostępny
- Wszystkie API callsy do backendu
- Brak dev panelu

## Troubleshooting

### Problem: Dev Panel nie pojawia się (Web)

**Rozwiązanie:**
- Sprawdź czy aplikacja jest w development mode
- Spróbuj F12 → Console, wpisz: `localStorage.setItem('arbor-test-mode', 'true'); location.reload();`

### Problem: Zmiana roli nie działa (Mobile)

**Rozwiązanie:**
- Aplikacja wymaga przeładowania (`location.reload()` web, lub nawigacja)
- Sprawdź czy `AsyncStorage` jest dostępna

### Problem: API Mocks nie zwracają danych

**Rozwiązanie:**
- Sprawdź endpoint w `getMockData()` / `getMockDataMobile()`
- Dodaj nowy mapping jeśli endpoint brakuje
- Weryfikuj typ danych zwracanych

## Rozszerzanie

### Dodaj Nowych Testowych Użytkownika

Web (`web/src/utils/testMode.js`):
```javascript
export const TEST_USERS = {
  specjalista: {
    id: 9005,
    imie: 'Test',
    nazwisko: 'Specjalista',
    email: 'specjalista@test.local',
    rola: 'Specjalista',
    oddzial_id: 1,
  },
  // ...
};
```

Mobile (`mobile/utils/testMode.ts`):
```typescript
export const TEST_USERS_MOBILE = {
  specjalista: {...},
  // ...
};
```

### Dodaj Nowe Mockowe Dane

Web:
```javascript
export const MOCK_DATA = {
  zlecenia: [...],
  raporty: [
    { id: 1, data: '2024-05-01', liczba_zadan: 15 },
  ],
};
```

### Dodaj Nowy Endpoint do Mockowania

```javascript
function getMockData(endpoint) {
  const mapping = {
    '/zlecenia': MOCK_DATA.zlecenia,
    '/raporty': MOCK_DATA.raporty,  // ← nowy
  };
  return mapping[endpoint] || [];
}
```

## Zasoby

- Web App: `web/src/utils/testMode.js`
- Web Dev Panel: `web/src/components/DevPanel.js`
- Mobile Utils: `mobile/utils/testMode.ts`
- Mobile Hook: `mobile/hooks/useTestMode.ts`
- Mobile Screen: `mobile/app/test-mode.tsx`

---

**Wersja:** 1.0  
**Data:** Maj 2024  
**Status:** 🟢 Aktywne
