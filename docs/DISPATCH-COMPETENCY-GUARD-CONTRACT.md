# Dispatch competency guard contract

Cel: dispatcher i reczne przypisanie stosuja ta sama twarda regule kompetencji. Plan z solvera nie moze byc zastosowany, jesli aktualny sklad ekipy nie ma aktywnych wymaganych uprawnien.

## Zakres

- `POST /api/dispatch/plan` i `/plan/save` przekazuja solverowi tylko aktywne kompetencje ekip.
- Aktywna kompetencja to `user_competencies.data_waznosci IS NULL` albo `>= CURRENT_DATE`.
- `POST /api/dispatch/apply/:id` przed `UPDATE tasks` sprawdza pary `task_id/team_id` z zapisanego planu.
- Blokada apply zwraca HTTP 409, `TEAM_COMPETENCY_BLOCKED`, `blocked_assignments` i `missing_competencies`.
- `AutoDispatch` pokazuje brakujace kompetencje dla zablokowanych przypisan.

## Reguly

- Brak `tasks.wymagane_kompetencje` oznacza brak blokady dla danego stopu.
- Wymagana kompetencja moze byc pokryta przez dowolnego czlonka ekipy.
- Porownanie nazw kompetencji jest niewrazliwe na wielkosc liter.
- Blokada kompetencji dziala przed transakcja `BEGIN` i przed `UPDATE tasks`.

## GO

- `npm run verify:dispatch-competency-guard` przechodzi.
- Test dispatchera potwierdza `TEAM_COMPETENCY_BLOCKED` przy apply zapisanego planu.
- Test dispatchera potwierdza, ze solver bierze tylko aktywne kompetencje.
- AutoDispatch pokazuje szczegoly `blocked_assignments`.

## NO-GO

- `/dispatch/apply/:id` robi bezposredni `UPDATE tasks` bez walidacji kompetencji.
- Wygasle kompetencje trafiaja do solvera jako aktywne.
- UI pokazuje tylko ogolny blad bez brakujacych kompetencji.
