# Material inventory contract

Cel: `#/magazyn` jest magazynem materialow eksploatacyjnych, a nie lista sprzetu. Kierownik moze widziec stany, dodawac kartoteki, przyjmowac material i robic rozchod na konkretne zlecenie.

## Zakres

- Backend udostepnia `/api/magazyn/materialy` dla listy i tworzenia kartotek materialow.
- Backend udostepnia `/api/magazyn/ruchy` dla przyjec i rozchodow.
- Rozchod wymaga `task_id`, bo ma byc przypisany do zlecenia.
- Rozchod nie moze zejsc ponizej dostepnego stanu i zwraca `stan_magazynu_za_maly`.
- Dane sa scope'owane po `oddzial_id`: Kierownik/Brygadzista/Magazynier widzi swoj oddzial, Dyrektor/Admin moze widziec wszystkie albo wskazany oddzial.
- `#/magazyn` pokazuje KPI kartotek, niskich stanow i wartosci, formularz nowego materialu, formularz ruchu oraz liste stanow.

## Dane

- `inventory_materials`: kartoteka materialu, jednostka, SKU, minimum, koszt jednostkowy i aktualny stan.
- `inventory_movements`: przyjecie/rozchod, material, ilosc, zlecenie, koszt, notatka i operator.

## GO

- `npm run verify:material-inventory` przechodzi.
- Test backendu potwierdza branch scope, przyjecie, rozchod i blokade zbyt malego stanu.
- Test web potwierdza render stanow, dodanie materialu i rozchod na zlecenie.
- Checklist pilota zawiera bramke magazynu materialow.

## NO-GO

- `#/magazyn` dalej pokazuje tylko sprzet z `/api/flota/sprzet`.
- Rozchod materialu nie wymaga zlecenia.
- Rozchod moze zrobic ujemny stan.
- Kierownik moze zapisac ruch w cudzym oddziale.
