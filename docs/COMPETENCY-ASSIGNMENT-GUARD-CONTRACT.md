# Competency assignment guard contract

Cel: zlecenie z wymaganymi kompetencjami nie moze zostac recznie przypisane do ekipy, ktora nie ma aktywnych uprawnien w skladzie.

## Zakres

- `PUT /api/tasks/:id/przypisz` blokuje przypisanie ekipy bez wymaganych kompetencji.
- `PUT /api/tasks/:id/office-plan` blokuje plan biura dla ekipy bez wymaganych kompetencji.
- `PUT /api/tasks/:id` blokuje ogolna edycje zlecenia, jesli zmiana ustawia ekipe bez wymaganych kompetencji.
- Walidacja korzysta z `tasks.wymagane_kompetencje`, `team_members` i `user_competencies`.
- Kompetencja jest aktywna, jesli `data_waznosci IS NULL` albo `data_waznosci >= CURRENT_DATE`.
- Front pokazuje komunikat `TEAM_COMPETENCY_BLOCKED` z lista `missing_competencies`.

## Reguly

- Brak `wymagane_kompetencje` oznacza brak blokady kompetencji.
- Wymagana kompetencja moze byc pokryta przez dowolnego czlonka przypisywanej ekipy.
- Porownanie nazw kompetencji jest niewrazliwe na wielkosc liter.
- Blokada zwraca HTTP 409 i nie wykonuje `UPDATE tasks`.

## GO

- `npm run verify:competency-assignment-guard` przechodzi.
- Test backendu potwierdza `TEAM_COMPETENCY_BLOCKED`.
- Glowny helper UI pokazuje brakujace kompetencje.
- Backlog i checklist pilota wskazuja ten kontrakt.

## NO-GO

- Reczne przypisanie ignoruje `tasks.wymagane_kompetencje`.
- Wygasle uprawnienia licza sie jako aktywne.
- API zwraca ogolny blad bez `missing_competencies`.
