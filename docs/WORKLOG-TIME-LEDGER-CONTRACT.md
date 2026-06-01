# Worklog time ledger contract

Cel: HR/Kierownik ma automatyczna ewidencje czasu pracy liczona z zamknietych `work_logs`, bez recznego przepisywania godzin.

## Zakres

- `GET /api/godziny/ecp?from=YYYY-MM-DD&to=YYYY-MM-DD` zwraca dzienne pozycje ECP z work logow.
- Kierownik widzi tylko swoj `oddzial_id`; Dyrektor/Admin/Prezes moga podac `oddzial_id` albo widziec wszystkie oddzialy.
- Opcjonalny `user_id` filtruje raport do jednego pracownika.
- Raport liczy `godziny`, `godziny_normatywne`, `nadgodziny`, `zlecenia_count` i `work_logs_count`.
- Regula robocza nadgodzin: `daily_minutes_over_480`, czyli minuty dzienne powyzej 480.
- Odpowiedz zawiera `legal_note`, bo reguly nadgodzin wymagaja weryfikacji prawnej przed payroll.

## Dane

- Zrodlo: `work_logs` z `end_time IS NOT NULL`.
- Czas: `czas_pracy_minuty`, a gdy go brak, roznica `end_time - start_time`.
- Dzien pracy: `(start_time AT TIME ZONE 'Europe/Warsaw')::date`.
- Oddzial: `tasks.oddzial_id`, a w fallbacku `users.oddzial_id`.

## GO

- `npm run verify:worklog-time-ledger` przechodzi.
- Test backendu potwierdza raport ECP z podsumowaniem i nadgodzinami.
- Test backendu potwierdza branch scope Kierownika oraz filtr Dyrektora.
- Odwrocony zakres dat zwraca `data_do_przed_data_od`.

## NO-GO

- Raport bierze aktywne, niezatrzymane work logi.
- Kierownik widzi cudzy oddzial.
- Nadgodziny trafiaja do payroll bez informacji o wymaganej weryfikacji prawnej.
