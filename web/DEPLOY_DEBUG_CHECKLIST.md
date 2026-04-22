# Deploy Debug Checklist (Ekipy)

Po deployu frontendu/backendu sprawdź kolejno:

1. Otwórz aplikację i zrób twardy refresh (`Ctrl+F5`).
2. Wejdź bezpośrednio na `https://<frontend-domain>/ekipy`.
   - Oczekiwane: brak `404`, ładuje się SPA.
3. W DevTools -> Network dodaj członka ekipy.
   - Oczekiwane requesty: `POST .../api/ekipy/:id/czlonkowie`
   - Oczekiwany status: `201` lub `200`
4. Jeśli status to `409`:
   - To poprawne dla duplikatu (pracownik już w ekipie).
5. Jeśli status to `500`:
   - Skopiuj `Response` z Network,
   - Skopiuj log z konsoli: `[api] request failed`.

## Szybka interpretacja błędów

- `history.pushState ... replaceState` -> ostrzeżenie przeglądarki, ignoruj.
- `Could not establish connection. Receiving end does not exist` -> rozszerzenie przeglądarki.
- `GET /ekipy 404` -> brak SPA rewrite lub stary build.
- `POST /api/ekipy/:id/czlonkowie 500` -> backend endpoint/data layer.
