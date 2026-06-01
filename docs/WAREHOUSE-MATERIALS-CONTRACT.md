# Warehouse Materials Contract

Cel: magazyn materialow eksploatacyjnych ma byc zrodlem prawdy dla stanow, przyjec i rozchodu na zlecenie.

## Zakres

- `GET /api/magazyn/materialy` zwraca materialy oddzialu, stan liczony z ruchow, `min_stan`, `niski_stan`, jednostke, koszt jednostkowy i oddzial.
- `POST /api/magazyn/materialy` tworzy kartoteke materialu w branch scope.
- `POST /api/magazyn/przyjecia` zapisuje dodatni ruch magazynowy.
- `POST /api/magazyn/rozchody` zapisuje rozchod, opcjonalnie z `task_id`, i blokuje zejscie ponizej zera kodem `WAREHOUSE_STOCK_UNDERFLOW`.
- `GET /api/magazyn/materialy/:id/ruchy` pokazuje ostatnie ruchy materialu z powiazaniem do zlecenia i uzytkownika.
- `#/magazyn` pokazuje KPI stanow, niskie stany, formularz nowego materialu, przyjecie i rozchod na zlecenie.

## GO

- Kierownik oddzialu widzi i zmienia tylko materialy swojego oddzialu.
- Dyrektor/Admin moga filtrowac i widziec oddzialy.
- Rozchod na zlecenie nie moze zejsc ponizej aktualnego stanu.
- Ruch z `task_id` musi nalezec do tego samego oddzialu co material.

## NO-GO

- Stan jest wpisywany recznie bez historii ruchow.
- Rozchod moze wygenerowac stan ujemny.
- UI nadal korzysta z `/flota/sprzet` jako magazynu.

## Weryfikacja

- `npm run verify:warehouse-materials`
- `npm test -w arbor-os -- magazyn.test.js`
