# Mobile material/offline cost flow

Cel: brygadzista zamyka zlecenie z materialami, paliwem, utylizacja i innymi kosztami nawet przy slabej sieci, a backend zapisuje dane do rozliczenia i BI.

## Kontrakt mobile

- Finish modal ma pola:
  - `finishUsageNazwa`
  - `finishUsageIlosc`
  - `finishUsageKoszt`
  - `finishOperationalCosts.sprzet`
  - `finishOperationalCosts.paliwo`
  - `finishOperationalCosts.utylizacja`
  - `finishOperationalCosts.inne`
- `parseOptionalFinishMoney`, `buildFinishMaterialUsage`, `buildFinishOperationalCostRows` i `suggestedFinishOperationalCosts` sa wspolnymi helperami w `mobile/utils/zlecenie-detail.ts`.
- `POST /tasks/:id/finish` wysyla:
  - `zuzyte_materialy[].nazwa`
  - `zuzyte_materialy[].ilosc`
  - `zuzyte_materialy[].koszt_laczny`
  - `koszty_operacyjne[].category`
  - `koszty_operacyjne[].amount`
  - `koszty_operacyjne[].source = "mobile_finish"`
- Gdy API zwraca 5xx albo nie ma sieci, `queueTaskFinishOffline` zapisuje caly finish payload z `Idempotency-Key` i dedupe `finish:<Idempotency-Key>`.
- Cache detalu zlecenia zachowuje `mobile_finish_payload.zuzyte_materialy` i `mobile_finish_payload.koszty_operacyjne`, zeby operator widzial lokalny pending.

## Kontrakt backendu

- `TASK_FINISH_REQUIRE_MATERIAL_USAGE=1` wymusza co najmniej jeden material przy finish ekipy.
- `validateFinishCostPayload` odrzuca ujemne, nieznane i nienaturalnie wysokie koszty.
- `insertFinishMaterialUsageRows` zapisuje materialy do `task_finish_material_usage`.
- `insertOperationalCostRows` zapisuje `sprzet`, `paliwo`, `utylizacja`, `inne` do `task_operational_costs`.
- BI i Kommo czytaja `task_finish_material_usage`, `task_operational_costs.paliwo`, `task_operational_costs.utylizacja`, `task_operational_costs.sprzet` i `task_operational_costs.inne`.

## Manualny smoke offline

1. Otworz zlecenie jako brygadzista w `W_Realizacji`.
2. Uzupelnij platnosc, material, koszt materialu, paliwo i utylizacje.
3. Wlacz airplane mode lub zasymuluj 5xx API.
4. Kliknij `Zamknij zlecenie`.
5. Oczekiwane: finish trafia do kolejki offline, a szczegoly zlecenia maja `mobile_finish_pending`.
6. Przywroc siec i wykonaj flush.
7. Oczekiwane: backend zapisuje `task_finish_material_usage`, `task_operational_costs`, payment i status `Zakonczone` bez duplikatow.

## Automatyczna bramka

```powershell
cd C:\Users\paha1\arbor
npm run verify:mobile-material-cost-flow
npm run test:offline-queue -w arbor-mobile
npm run test:zlecenie-detail -w arbor-mobile
npm test -w arbor-os -- tasks
```

## GO

- `npm run verify:mobile-material-cost-flow` przechodzi.
- Offline cache zachowuje `mobile_finish_payload.zuzyte_materialy` i `mobile_finish_payload.koszty_operacyjne`.
- Backend ma testy `TASK_FINISH_REQUIRE_MATERIAL_USAGE`, walidacji kosztow i zapisu operacyjnego.
- BI/Kommo maja zrodla kosztow materialow, paliwa i utylizacji.

## NO-GO

- Finish offline gubi koszty lub materialy.
- Mobile akceptuje ujemne koszty.
- Backend zapisuje finish, ale pomija `task_finish_material_usage` albo `task_operational_costs`.
- BI/Kommo pokazuja marze bez kosztow materialow, paliwa lub utylizacji.
