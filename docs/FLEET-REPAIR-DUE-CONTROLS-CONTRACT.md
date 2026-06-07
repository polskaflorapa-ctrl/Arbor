# Fleet Repair Due Controls Contract

Cel: naprawy pojazdow i sprzetu maja byc kontrolowane terminem odbioru oraz priorytetem, tak aby kierownik szybko widzial naprawy po terminie przed planowaniem ekip.

## Zakres

- Ekran `#/flota?tab=naprawy` pokazuje termin odbioru i priorytet przy kazdej naprawie.
- Formularz naprawy zapisuje `termin_odbioru` oraz `priorytet`.
- Formularz naprawy zapisuje `data_zakonczenia` i `strata_dzienna`, zeby policzyc dni oraz koszt przestoju.
- Lista napraw ma filtr `Po terminie`.
- Panel napraw pokazuje liczbe napraw po terminie oraz blisko terminu.
- Eksport CSV napraw zawiera `termin_odbioru`, `termin_status` i `priorytet`.
- Eksport CSV napraw zawiera `przestoj_dni`, `strata_dzienna` i `strata_przestoju`.
- Produkcyjne API `os` oraz lokalny full-stack przyjmuja i zachowuja `termin_odbioru` oraz `priorytet`.
- Migracja dodaje pola do tabeli `repairs`.

## API

`POST /api/flota/naprawy` przyjmuje:

- `termin_odbioru`: opcjonalna data `YYYY-MM-DD`
- `data_zakonczenia`: opcjonalna data `YYYY-MM-DD`
- `strata_dzienna`: opcjonalna kwota utraconego potencjalu dziennie
- `priorytet`: `Normalny`, `Pilny`, `Krytyczny` albo inna krotka wartosc tekstowa

`PUT /api/flota/naprawy/:id` zachowuje istniejace wartosci, jesli payload ich nie nadpisuje.

## UI

GO:

- Naprawa z terminem w przeszlosci ma status `overdue` i trafia do filtra `Po terminie`.
- Naprawa z terminem do 2 dni ma status `soon`.
- Zamknieta naprawa nie jest liczona jako po terminie.
- Priorytet `Krytyczny` i `Pilny` jest widocznie odrozniony na liscie.

NO-GO:

- UI wysyla pola, ale backend je ignoruje.
- Eksport CSV nie pozwala odfiltrowac po terminach poza aplikacja.
- Zamkniete naprawy nadal generuja alert po terminie.

## Automatyczna bramka

```powershell
npm run verify:fleet-repair-due-controls
npm test -w arbor-os -- --runInBand tests/flota-crud.test.js
npm test -w arbor-web -- src/pages/Flota.test.js
```
