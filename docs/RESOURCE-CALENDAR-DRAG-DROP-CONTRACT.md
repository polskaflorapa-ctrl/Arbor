# Resource calendar drag & drop contract

Cel: kierownik moze przesunac zlecenie w kalendarzu zasobow miedzy ekipa, dniem i slotem godzinowym, a system zapisuje zmiane w API oraz blokuje kolizje przed i po stronie backendu.

## Zakres

- Widok: `#/kalendarz-zasobow`, zakladka planowania ekip.
- Element przeciagany: karta zlecenia `day-task-*` albo karta z kolejki planowania.
- Cel dropu: slot `team-slot-{teamId}-{YYYY-MM-DD}-{HH:mm}`.
- API zapisu: `PATCH /api/tasks/:id/plan`.

## Payload DnD

```json
{
  "data_planowana": "2026-06-01T08:00:00",
  "godzina_rozpoczecia": "08:00",
  "ekipa_id": 3,
  "absence_override": false
}
```

Backend aktualizuje `data_planowana`, `godzina_rozpoczecia`, `ekipa_id`, przesuwa aktywne rezerwacje sprzetu powiazane ze zleceniem na nowy dzien i promuje zlecenie do `Zaplanowane`, jezeli pakiet biurowy jest kompletny.

## Walidacje

GO:

- drop na wolny slot ekipy zapisuje plan przez `PATCH /api/tasks/:id/plan`;
- przesuniecie na inny dzien przesuwa aktywne rezerwacje sprzetu zlecenia;
- drop na nieobecna ekipe wymaga jawnego potwierdzenia kierownika i wysyla `absence_override=true`;
- backend ponownie sprawdza oddzial, okno klienta, nieobecnosc ekipy i konflikt zakresu czasu.

NO-GO:

- zlecenia zakonczonego albo anulowanego nie mozna przesunac;
- slot z kolizja innego aktywnego zlecenia tej samej ekipy nie wywoluje API z weba;
- backend zwraca `409 TASK_PLAN_CONFLICT`, jezeli kolizja pojawi sie mimo lokalnej walidacji;
- slot poza zaakceptowanym oknem klienta zwraca `409 TASK_CLIENT_TIME_WINDOW_CONFLICT`.

## Automatyczna bramka

```powershell
npm run verify:resource-calendar-dnd
npm test -w arbor-web -- KalendarzZasobow.test.js
npm test -w arbor-os -- tasks.test.js
```
