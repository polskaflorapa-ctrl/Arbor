# Machine usage blocks contract

Cel: Kierownik widzi przypomnienia o terminach przegladow/OC/motogodzinach w `#/flota`, a backend blokuje uzycie sprzetu, ktory nie powinien wyjechac do zlecenia.

## Zakres

- `GET /api/flota/sprzet` pozostaje zrodlem kart sprzetu i zwraca `data_przegladu`, `koszt_motogodziny`, status oraz `przeglad_alert`.
- `GET /api/flota/pojazdy` pozostaje zrodlem kart pojazdow z `data_przegladu`, `data_ubezpieczenia`, statusem i przebiegiem.
- `#/flota` pokazuje dla kart po terminie albo w statusie serwisowym etykiete `BLOKADA` i tekst `Blokuje uzycie`.
- `POST /api/flota/rezerwacje` blokuje aktywna rezerwacje, gdy sprzet ma status serwisowy albo `data_przegladu` jest starsza niz `data_od`.
- `PATCH /api/flota/rezerwacje/:id` blokuje przesuniecie rezerwacji za termin przegladu.
- Blokada nie zastepuje kolizji rezerwacji: po przejsciu reguly terminow nadal dziala `rezerwacja_kolizja_sprzet`.

## Reguly

- `sprzet_przeglad_po_terminie`: `equipment_items.data_przegladu < data_od`.
- `sprzet_niedostepny`: status zawiera `napraw`, `niedost` albo `serwis`.
- Brak daty przegladu daje przypomnienie operacyjne w karcie, ale nie blokuje rezerwacji.
- Anulowana rezerwacja nie jest blokowana przez regule przegladu przy tworzeniu.

## GO

- Test backendu potwierdza blokade rezerwacji po terminie przegladu.
- Test backendu potwierdza blokade statusu serwisowego.
- Test backendu potwierdza blokade przesuniecia rezerwacji po terminie przegladu.
- Test web potwierdza etykiete `BLOKADA` i tekst `Blokuje uzycie`.
- `npm run verify:machine-usage-blocks` przechodzi.

## NO-GO

- Sprzet po terminie moze dostac aktywna rezerwacje.
- Przesuniecie rezerwacji pozwala obejsc termin przegladu.
- Kierownik nie widzi, ktora karta blokuje uzycie.
