# Mobile START/STOP work log edge cases

Cel: START/STOP w mobile ma byc bezpieczny dla pilota, spójny z `work_logs` i odporny na powtórki requestow albo slabą siec.

## Kontrakt backendu

- `POST /api/tasks/:id/start` wymaga GPS dla roli terenowej oraz kompletnej checklisty BHP.
- START odrzuca zamkniete zlecenie z `reason: TASK_NOT_STARTABLE`.
- START odrzuca drugi aktywny `work_logs.end_time IS NULL` z `reason: TASK_WORK_LOG_ACTIVE` i zwraca `work_log_id`.
- Powtórka START z tym samym `Idempotency-Key` zwraca `idempotent_replay: true` zamiast tworzyc drugi log.
- `POST /api/tasks/:id/stop` wymaga `work_log_id`.
- STOP wymaga GPS dla roli terenowej.
- STOP odrzuca obcy albo nieistniejacy log z `reason: TASK_WORK_LOG_NOT_FOUND`.
- STOP odrzuca drugi STOP dla zakonczonego logu z `reason: TASK_WORK_LOG_ALREADY_STOPPED`.
- STOP zapisuje `end_lat`, `end_lng`, `czas_pracy_minuty`, status zlecenia `Zakonczone` oraz `data_zakonczenia`.
- Powtórka STOP z tym samym `Idempotency-Key` zwraca `idempotent_replay: true`.

## Kontrakt mobile/offline

- START i check-in uzywaja `queueTaskWorkSignalOffline`.
- START ma stabilny `createOfflineRequestId(\`task-${id}-start\`)`.
- Check-in ma stabilny `createOfflineRequestId(\`task-${id}-checkin\`)`.
- Offline queue deduplikuje sygnaly pracy przez `work:<kind>:<id>`.
- Konflikty idempotency i finish sa opisane w `docs/MOBILE-OFFLINE-CONFLICT-IDEMPOTENCY.md`.

## Testy

Automatyczna bramka:

```powershell
npm run verify:mobile-start-stop-edge
npm test -w arbor-os -- tasks --runInBand
```

Manualny smoke pilota:

1. Brygadzista otwiera przypisane zlecenie.
2. START bez GPS pokazuje blad i nie tworzy logu.
3. START z GPS i checklistą tworzy jeden aktywny `work_log`.
4. Drugi START dla tego zlecenia pokazuje konflikt aktywnej pracy.
5. STOP bez GPS pokazuje blad.
6. STOP z GPS zamyka aktywny log i zlecenie.
7. Drugi STOP dla tego samego `work_log_id` pokazuje konflikt zamknietego logu.

## GO / NO-GO

GO:

- `verify:mobile-start-stop-edge` przechodzi.
- `npm test -w arbor-os -- tasks --runInBand` przechodzi.
- Mobile nie tworzy duplikatow `work_logs` po podwojnym kliknieciu START.
- STOP nie zamyka zlecenia bez aktywnego logu i GPS brygadzisty.

NO-GO:

- START/STOP moze zgubic GPS bez bledu.
- Podwojny START tworzy drugi aktywny log.
- Podwojny STOP nadpisuje zamkniety log bez czytelnego konfliktu.
