# Team Competency Assignment Block Contract

## Cel

ARBOR nie moze przypisac zlecenia do ekipy, jezeli zlecenie ma `wymagane_kompetencje`, a aktywni czlonkowie ekipy nie maja kompletu tych kompetencji.

To jest twarda blokada EPIC 7.3. Ostrzezenia o wygasaniu uprawnien z EPIC 7.2 zostaja widoczne w kadrach, ale przypisanie zlecenia ma zatrzymac sie na API.

## Regula

- Wymagania pochodza z `tasks.wymagane_kompetencje`.
- Kompetencje ekipy pochodza z `user_competencies` przez `team_members`.
- Kompetencja jest wazna, gdy `data_waznosci IS NULL` albo `data_waznosci >= dzien planu`.
- Porownanie nazw jest case-insensitive.
- Brak wymaganych kompetencji w zadaniu oznacza brak blokady.

## API

Wspolna walidacja jest w `assertTeamCompetenciesForTask`.

Blokowane sciezki:

- `PATCH /api/tasks/:id/plan`
- `PUT /api/tasks/:id`
- `PUT /api/tasks/:id/office-plan`
- `PUT /api/tasks/:id/przypisz`
- `POST /api/dispatch/apply/:id`

Odpowiedz blokady:

```json
{
  "code": "TEAM_COMPETENCY_MISSING",
  "missing_competencies": ["SEP"],
  "required_competencies": ["SEP", "Arborysta"],
  "team_competencies": ["Arborysta"]
}
```

## UI

Frontend pokazuje czytelny komunikat z `missing_competencies` przez `getApiErrorMessage`.

Dodatkowo:

- `Kierownik` pokazuje blokade przy szybkim przypisaniu.
- `AutoplanDnia` zlicza blokady kompetencji w batchu.
- Widoki korzystajace z `getApiErrorMessage`, np. `Zlecenia`, `Harmonogram` i `MapaLive`, dostaja komunikat bez osobnej logiki.

## GO

- Reczne przypisanie ekipy bez wymaganych kompetencji zwraca `409 TEAM_COMPETENCY_MISSING`.
- Zastosowanie zapisanego planu dispatchera zatrzymuje sie przed `BEGIN` i nie wykonuje `UPDATE tasks`.
- UI pokazuje brakujace kompetencje, a nie ogolny blad.

## NO-GO

- Ktora kolwiek sciezka zapisu `ekipa_id` pozwala ominac walidacje.
- Walidacja ignoruje `data_waznosci`.
- API nie zwraca `missing_competencies`.
- Dispatcher moze zastosowac zapisany plan mimo brakow kompetencji.
