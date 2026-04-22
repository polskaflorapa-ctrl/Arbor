# Render Backend Hotfix Steps (Ekipy 500)

Cel: usunąć `500` na `POST /api/ekipy/:id/czlonkowie` oraz ustabilizować przypisania członków.

## 1) Wgraj route patch

1. Skopiuj plik `backend_routes_ekipy.js` do backend repo.
2. Podłącz router w aplikacji backend:

```js
const ekipyRouter = require('./routes/ekipy'); // dostosuj ścieżkę
app.use('/ekipy', ekipyRouter);
```

3. Upewnij się, że w pliku route są dostępne:
   - `pool` (pg),
   - `requireAuth`.

## 2) Uruchom migrację SQL

Uruchom `migration_ekipy_members_stability.sql` na bazie produkcyjnej:
- usuwa duplikaty,
- dodaje unikalność `(team_id, user_id)`,
- dodaje indeksy.

## 3) Deploy backend na Render

1. Commit + push backend.
2. Trigger deploy usługi backend.
3. Sprawdź log startu czy route `/ekipy` został podpięty.

## 4) Test API po deployu

Wykonaj testy:

1. Dodanie nowego członka:
   - oczekiwane: `201`/`200`.
2. Ponowne dodanie tego samego:
   - oczekiwane: `409` (bez `500`).
3. Usunięcie członka:
   - oczekiwane: `200`.
4. Usunięcie nieistniejącego przypisania:
   - oczekiwane: `404`.

## 5) Test UI po deployu frontendu

1. Otwórz aplikację i sprawdź marker:
   - `[arbor-web] build marker: 2026-04-20-hashrouter`
2. Dodaj członka ekipy z UI.
3. W razie błędu sprawdź log:
   - `[api] request failed` (zawiera method/url/status/responseData).
