# Equipment Usage Rules Contract

Cel: sprzet widoczny w kartach floty ma te same reguly uzycia w rezerwacjach. Alert o przegladzie nie jest tylko informacja, ale blokuje planowanie po terminie.

## Zakres

- `GET /api/flota/sprzet` zwraca `data_przegladu`, `przeglad_alert`, `koszt_motogodziny`, status, oddzial i najblizsza rezerwacje.
- `POST /api/flota/rezerwacje` blokuje rezerwacje sprzetu, jezeli `data_przegladu` wypada przed koncem rezerwacji.
- Blokada zwraca `409`, `sprzet_przeglad_po_terminie` oraz `EQUIPMENT_INSPECTION_OVERDUE`, z identyfikatorem, nazwa i data przegladu sprzetu.
- `#/rezerwacje-sprzetu` oznacza sprzet z przegladem po terminie i blokuje wybor takiego zasobu w formularzu.
- `#/flota` pozostaje miejscem przypomnien: przeglad, OC pojazdu, status, koszt motogodziny i najblizsza rezerwacja.

## GO

- Kierownik widzi przypomnienie o przegladzie na karcie sprzetu.
- Kierownik nie moze zarezerwowac sprzetu, ktory bedzie po terminie przegladu w danym zakresie dat.
- API zwraca odroznialny kod bledu, zeby UI pokazal komunikat o przegladzie zamiast ogolnej kolizji.
- Koszt motogodziny zostaje w karcie sprzetu jako podstawa dalszego rozliczania zuzycia.

## NO-GO

- System pozwala uzyc sprzetu po terminie przegladu.
- UI ukrywa powod blokady albo pokazuje tylko ogolny blad.
- Branch scope rezerwacji jest omijany przez nowa regule.

## Weryfikacja

- `npm run verify:equipment-usage-rules`
- `npm test -w arbor-os -- flota-rezerwacje.test.js`
