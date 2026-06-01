# Dispatcher Competency Consistency Contract

## Cel

EPIC 1.5 i EPIC 7.3 musza uzywac tej samej logiki kompetencji. Dispatcher nie moze zaproponowac ani zapisac planu, ktory potem zostanie odrzucony przez twarda blokade przypisania.

## Regula wspolna

- Zlecenie wymaga kompetencji z `tasks.wymagane_kompetencje`.
- Ekipa ma kompetencje czlonkow z `user_competencies` przez `team_members`.
- Kompetencja liczy sie jako aktywna tylko wtedy, gdy `data_waznosci IS NULL` albo `data_waznosci >= dzien planu`.
- Solver VRP uzywa tylko aktywnych kompetencji.
- `dispatch/apply` nadal wykonuje twardy guard `TEAM_COMPETENCY_MISSING` jako ostatnia bramka bezpieczenstwa.

## Backend

`fetchTeamsForDispatch` w `os/src/routes/dispatch.js` filtruje kompetencje po dacie planu:

```sql
uc.data_waznosci IS NULL OR uc.data_waznosci >= $1::date
```

`vrp.solve` zwraca `unassigned` z:

- `reason: no_capable_team`,
- `missing_competencies`,
- czytelnymi `details`.

`POST /api/dispatch/apply/:id` zwraca `409 TEAM_COMPETENCY_MISSING`, jezeli zapisany plan stal sie niespojny, np. uprawnienie wygaslo po zapisaniu planu.

## UI

`AutoDispatch`:

- pokazuje `missing_competencies` przez `getApiErrorMessage`,
- zapisuje `plan.competency_block`,
- pokazuje panel `Blokada kompetencji` przy nieudanym `dispatch/apply`.

`Harmonogram` i cockpit Kierownika korzystaja ze wspolnego `getApiErrorMessage`, wiec pokazuja ten sam komunikat.

## GO

- Solver nie traktuje przeterminowanych kompetencji jako dostepnych.
- Zapisany plan, ktory stracil wazna kompetencje przed zastosowaniem, zatrzymuje sie na `TEAM_COMPETENCY_MISSING`.
- UI operatora pokazuje, ktorego zlecenia, ekipy i kompetencji dotyczy blokada.

## NO-GO

- Solver i `dispatch/apply` maja rozne zasady daty waznosci.
- AutoDispatch pokazuje tylko ogolny blad przy `TEAM_COMPETENCY_MISSING`.
- `unassigned` nie zawiera `missing_competencies` dla braku kompetencji.
