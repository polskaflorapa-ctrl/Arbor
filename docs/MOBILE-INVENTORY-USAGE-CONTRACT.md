# Mobile inventory usage contract

Cel: raport zuzycia materialow przy finish moze rozchodowac material z magazynu, jezeli payload zawiera `zuzyte_materialy[].material_id`.

## Zakres

- Stare payloady `zuzyte_materialy[]` bez `material_id` nadal zapisuja tylko `task_finish_material_usage`.
- Payload z `material_id` wykonuje rozchod w `inventory_materials` i dopisuje `inventory_movements` z `typ = rozchod`.
- Rozchod jest w tej samej transakcji co finish zlecenia.
- Gdy stan jest za maly albo material jest z innego oddzialu zlecenia, backend zwraca `409 stan_magazynu_za_maly`.
- Web finish w `ZlecenieDetail` moze wybrac material z `/api/magazyn/materialy` i wyslac `material_id`.
- Mobile helper `buildFinishMaterialUsage` akceptuje opcjonalne `materialId` i przenosi je do `zuzyte_materialy[].material_id`.

## GO

- `npm run verify:mobile-inventory-usage` przechodzi.
- Test backendu potwierdza rozchod magazynu przy finish z `material_id`.
- Test backendu potwierdza blokade finish bez wystarczajacego stanu.
- Integracja nie psuje dotychczasowego finish bez `material_id`.

## NO-GO

- Finish z `material_id` zapisuje koszt, ale nie zmniejsza `inventory_materials.stan`.
- Rozchod magazynowy powstaje poza transakcja finish.
- Brak stanu konczy zlecenie mimo bledu magazynu.
- Mobile/web nie potrafia przeniesc `material_id` w payloadzie.
