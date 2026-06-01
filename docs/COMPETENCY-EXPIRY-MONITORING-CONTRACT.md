# Competency Expiry Monitoring Contract

## Cel

ARBOR ma pokazywac waznosc uprawnien w kartach pracownika, zanim kierownik przypisze osobe do pracy terenowej. W pilocie jest to ostrzezenie kadrowe, a twarda blokada przypisania jest osobnym pakietem EPIC 7.3.

## Zrodlo danych

- Zrodlem prawdy jest tabela `user_competencies`.
- Pole `data_waznosci` okresla termin waznosci uprawnienia.
- Brak `data_waznosci` oznacza brak alertu terminowego, nie automatyczna waznosc.

## API

### `GET /api/hr/position-cards`

Kazda karta pracownika zwraca pola:

- `expired_competencies_count` - liczba uprawnien po terminie.
- `expiring_competencies_count` - liczba uprawnien waznych maksymalnie 30 dni.
- `nearest_competency_expiry` - najblizsza data waznosci uprawnienia.
- `competency_status` - `expired`, `expiring` albo `ok`.

Endpoint zachowuje branch scope: Kierownik widzi tylko swoj oddzial, Dyrektor/Admin moze widziec calosc albo filtrowac po oddziale.

### `GET /api/hr/competency-expiry?days=90`

Endpoint zwraca liste uprawnien wygaslych albo wygasajacych w zadanym horyzoncie. Kazdy wpis ma:

- `days_left`
- `expired`
- `status`
- `severity`
- `renewal_required`
- `source: user_competencies`

Parametr `days` jest ograniczony do zakresu 7-365.

## UI

Widok `KadryDokumenty`:

- pobiera `/position-cards` oraz `/hr/competency-expiry?days=90`,
- pokazuje KPI `Wygasle uprawnienia` i `Do odnowienia`,
- pokazuje metryke `Uprawnienia` w kazdym wierszu pracownika,
- eksportuje do CSV liczniki i najblizsza date waznosci.

Widok `Uzytkownicy` pozostaje miejscem edycji kompetencji i dat `data_waznosci`.

## GO

- HR widzi wygasle i wygasajace uprawnienia bez przechodzenia do profilu pracownika.
- CSV zawiera stan uprawnien na potrzeby przygotowania pilota.
- Branch scope jest zachowany dla Kierownika.

## NO-GO

- Karta pracownika nie pokazuje `expired_competencies_count` ani `competency_status`.
- Alerty nie pochodza z `user_competencies`.
- Kierownik widzi alerty z obcego oddzialu.
- UI nie pobiera `/hr/competency-expiry?days=90`.
