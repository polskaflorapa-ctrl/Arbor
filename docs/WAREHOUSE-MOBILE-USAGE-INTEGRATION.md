# Warehouse Mobile Usage Integration

Cel: raport zuzycia materialow z mobile/web finish automatycznie schodzi ze stanu magazynowego, gdy material jest powiazany z magazynem oddzialu.

## Zakres

- `POST /api/tasks/:id/finish` nadal zapisuje `zuzyte_materialy` do `task_finish_material_usage`.
- Wiersz `zuzyte_materialy[].material_id` jednoznacznie wskazuje material magazynowy, gdy klient UI/mobile go wysyla.
- Gdy `material_id` nie ma, backend probuje dopasowac material po `nazwa` w `warehouse_materials` tego samego oddzialu.
- Po dopasowaniu backend zapisuje `warehouse_material_movements` z `typ = 'rozchod'`, `task_id`, `user_id` i notatka `Finish zlecenia #...`.
- Jezeli stan magazynu jest za niski, finish zwraca `409` z `WAREHOUSE_STOCK_UNDERFLOW` i robi rollback calej transakcji.
- Material wpisany recznie, bez dopasowania do kartoteki, dalej zapisuje koszt do rozliczenia, ale nie zmienia magazynu.

## GO

- Brygadzista moze raportowac zuzycie tak jak dotad; nazwa zgodna z magazynem automatycznie robi rozchod.
- Kierownik widzi rozchod w magazynie jako ruch powiazany z konkretnym zleceniem.
- Brak stanu blokuje finish, zamiast robic stan ujemny.
- `task_finish_material_usage.material_id` pozwala przyszlemu UI/mobile wysylac wybor z listy magazynowej.

## NO-GO

- Finish zapisuje materialy, ale nie zmienia magazynu mimo dopasowania.
- Rozchod magazynu dzieje sie poza transakcja finishu.
- Stan magazynu moze zejsc ponizej zera.

## Weryfikacja

- `npm run verify:warehouse-mobile-usage`
- `npm test -w arbor-os -- tasks.test.js`
