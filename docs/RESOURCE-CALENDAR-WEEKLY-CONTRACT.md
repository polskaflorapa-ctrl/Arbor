# Resource calendar weekly contract

Cel: Kierownik ma jeden tygodniowy widok zasobow: ekipy, zaplanowane zlecenia, krytyczny sprzet i rezerwacje sprzetu. Widok ma byc uzywalny przed pilotem jako operacyjna tablica dnia i tygodnia.

## Zakres UI

- Web route: `#/kalendarz-zasobow`.
- Zakladka `Ekipy` pokazuje widok `Dzien` oraz `Zakres`.
- Zakladka `Sprzet` pokazuje rezerwacje w zakresie 2 albo 4 tygodni.
- Domyslny zakres to 14 dni od poniedzialku tygodnia wybranej daty.
- Filtr oddzialu zawęza ekipy, sprzet i alerty dla kierownika.
- Panel dyspozytorni dnia pokazuje zlecenia, nieobecne ekipy, rezerwacje sprzetu, delegacje i kolizje.
- Odprawa dnia oraz odprawa ekipy zawieraja zadania, BHP/ryzyka, sprzet, adres i link do mapy.

## Kontrakt API

- `GET /api/flota/sprzet` dostarcza zasoby sprzętowe z oddzialem, typem, statusem i przypisaniem do ekipy.
- `GET /api/ekipy` dostarcza ekipy oraz oddzial dostepnosci.
- `GET /api/tasks/wszystkie` albo `GET /api/tasks` dostarcza zlecenia z `data_planowana`, `godzina_rozpoczecia`, `czas_planowany_godziny`, `ekipa_id`, `oddzial_id` i notatkami planu.
- `GET /api/flota/rezerwacje?from=YYYY-MM-DD&to=YYYY-MM-DD` dostarcza rezerwacje sprzetu w zakresie, wraz z `task_id`, `task_klient_nazwa` i `task_adres`.
- `POST /api/flota/rezerwacje` tworzy rezerwacje, blokujac aktywne kolizje tego samego sprzetu.
- `PATCH /api/flota/rezerwacje/:id` przesuwa rezerwacje w kalendarzu, blokujac kolizje.
- `PUT /api/tasks/:id/office-plan` zapisuje plan ekipy i sprzetu ze szczegolu zlecenia albo kalendarza.

## Krytyczny sprzet

Na pilota krytyczny sprzet oznacza zasob, ktory blokuje start ekipy, jesli jest niedostepny albo ma konflikt rezerwacji. W praktyce sa to zasoby z `equipment_items`, ktore:

- sa przypisane do zlecenia przez `equipment_reservations`,
- wystepuja w notatce sprzetowej zlecenia,
- maja status serwis/awaria/wycofany,
- albo tworza kolizje w tym samym zakresie dat.

## Testy

Automatyczna bramka:

```powershell
npm run verify:resource-calendar-week
npm test -w arbor-web -- KalendarzZasobow
npm test -w arbor-os -- flota-rezerwacje --runInBand
```

## GO / NO-GO

GO:

- Kierownik widzi ekipy i sprzet w jednym route.
- Widok tygodniowy pobiera rezerwacje `from/to` dla zakresu.
- Kolizje ekip i sprzetu sa widoczne w dyspozytorni dnia.
- Rezerwacja sprzetu moze byc powiazana ze zleceniem i widoczna na pasku sprzętu.

NO-GO:

- Sprzet nie filtruje sie po oddziale.
- Rezerwacja aktywna moze nachodzic na inna rezerwacje tego samego sprzetu bez bledu.
- Widok tygodniowy nie pokazuje, ktore zlecenie trzyma krytyczny sprzet.
