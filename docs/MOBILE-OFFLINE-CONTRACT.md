# Mobile Offline Contract

Stan na: 2026-05-08

## Cel

Mobilka moze wykonac kluczowe akcje terenowe mimo chwilowego braku sieci. Jesli request online nie dojdzie albo serwer zwroci blad 5xx, aplikacja zapisuje operacje w `AsyncStorage` (`offline_queue_v1`) i wysyla ja ponownie po odzyskaniu lacznosci.

## Zasada Idempotency-Key

Kazda mutacja, ktora moze trafic do kolejki, powinna miec stabilny `Idempotency-Key`.

Ten sam klucz musi byc uzyty:

1. w pierwszym requestcie online,
2. w ewentualnym wpisie kolejki offline,
3. w kazdym retry podczas `flushOfflineQueue`.

Dzieki temu przypadek "serwer wykonal akcje, ale telefon nie dostal odpowiedzi" nie tworzy duplikatow.

## Obslugiwane akcje zlecenia

| Akcja mobile | Endpoint | Offline queue | Idempotency |
| --- | --- | --- | --- |
| Zmiana statusu | `PUT /api/tasks/:id/status` | Tak | Tak |
| Start pracy | `POST /api/tasks/:id/start` | Tak | Tak |
| Finish z platnoscia/materialami | `POST /api/tasks/:id/finish` | Tak | Tak |
| Zdjecie zlecenia | `POST /api/tasks/:id/zdjecia` | Tak, multipart | Tak |
| Zgloszenie problemu | `POST /api/tasks/:id/problemy` | Tak | Tak |

## Backend replay

Backend zapisuje klucze w `api_idempotency_log`.

Replay powinien zwracac odpowiedz bez powtarzania skutku ubocznego. Szczegolnie:

- zdjecie: drugie wyslanie tego samego klucza nie tworzy drugiego rekordu ani nie zostawia drugiego pliku,
- problem: drugi request nie tworzy drugiego wpisu,
- finish: drugi request zwraca wynik zakonczonego zadania, jesli zadanie jest juz zamkniete.

## Smoke

Backendowy smoke flow terenowego:

```powershell
cd C:\Users\paha1\arbor\os
npm run smoke:field
```

Sprawdza:

- `/api/ready`,
- login smoke,
- zgloszenie problemu z `opis`,
- normalizacje typu problemu `usterka -> Awaria_Sprzetu`,
- upload zdjecia,
- replay uploadu zdjecia z tym samym `Idempotency-Key`.

## Lokalne uruchomienie mobile

Przy pracy lokalnej mobile powinno dostac lokalny URL API:

```powershell
cd C:\Users\paha1\arbor\mobile
$env:EXPO_PUBLIC_API_URL="http://192.168.0.238:3100/api"
$env:EXPO_PUBLIC_WEB_APP_URL="http://192.168.0.238:3000"
$env:EXPO_NO_DEPENDENCY_VALIDATION="1"
npx expo start --host lan
```

`EXPO_NO_DEPENDENCY_VALIDATION=1` omija awarie Expo CLI na etapie walidacji wersji zaleznosci. Nie omija bundlowania aplikacji.
