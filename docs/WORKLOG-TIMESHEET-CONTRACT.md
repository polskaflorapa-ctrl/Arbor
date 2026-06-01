# Worklog Timesheet Contract

Cel: ewidencja czasu pracy powstaje automatycznie z mobilnych START/STOP w `work_logs`, bez przepisywania godzin do osobnego Excela.

## Zakres

- `GET /api/payroll/worklog-timesheet?month=YYYY-MM` zwraca miesieczna ECP liczona z `work_logs`.
- Zrodlo danych w odpowiedzi to `source: work_logs`.
- Kierownik widzi tylko swoj `oddzial_id`; Dyrektor/Admin widza calosc i moga filtrowac po `team_id`.
- Wiersze zawieraja `hours_total`, `hours_regular`, `hours_overtime`, `hours_night`, `days_count`, `tasks_count` i dzienny breakdown.
- Nadgodziny sa liczone informacyjnie jako suma godzin powyzej 8h dziennie; finalne reguly wymagaja weryfikacji prawnej.
- `payrollTeamDay` pozostaje silnikiem raportu dnia i wyplat, a ECP jest podgladem/audytem z tych samych `work_logs`.

## GO

- Kierownik moze pobrac ECP oddzialu bez recznego przepisywania godzin.
- ECP pokazuje nadgodziny i godziny nocne jako osobne pola.
- Endpoint odcina role terenowe od podgladu kierowniczego.
- Raport jasno oznacza, ze regula nadgodzin jest informacyjna.

## NO-GO

- ECP korzysta z recznych `godziny_potwierdzenia` zamiast `work_logs`.
- Kierownik widzi cudzy oddzial.
- Nadgodziny sa opisane jako ostateczna interpretacja prawna.

## Weryfikacja

- `npm run verify:worklog-timesheet`
- `npm test -w arbor-os -- payroll-worklog-timesheet.test.js`
