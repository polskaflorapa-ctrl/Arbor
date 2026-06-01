# Mobile offline conflict/idempotency coverage

Cel: kazda krytyczna akcja terenowa ma stabilny `Idempotency-Key`, wpis kolejki offline i czytelna decyzje po konflikcie sync.

## Kontrakt

- `flushOfflineQueue` wysyla `Idempotency-Key` rowny `OfflineQueueItem.id`.
- Retry uzywa backoff i nie blokuje calej kolejki jednym bledem.
- `TASK_ALREADY_FINISHED` przy 400/409 jest traktowany jako bezpiecznie zsynchronizowany replay.
- `IDEMPOTENCY_INCOMPLETE` zostaje w kolejce z `lastError`, zeby operator widzial konflikt i mogl ponowic po czasie.
- `queueTaskWorkSignalOffline` obsluguje START, check-in i legacy STOP z dedupe `work:<kind>:<id>`.
- `queueTaskPhotoOffline` obsluguje zdjecia multipart z dedupe `photo:<id>`.
- `queueTaskProblemOffline` obsluguje PROBLEM z dedupe `problem:<id>`.
- `queueTaskFinishOffline` obsluguje finish z platnoscia, materialami i kosztami z dedupe `finish:<id>`.

## Manualny smoke

1. Otworz zlecenie na telefonie i pobierz szczegoly online.
2. Wlacz airplane mode.
3. Wykonaj START, zdjecie Przed, PROBLEM, zdjecie Po i finish.
4. Oczekiwane: kazda akcja ma pending/offline UI, a licznik kolejki rosnie.
5. Przywroc siec i uruchom sync.
6. Oczekiwane: kolejka schodzi do zera albo pokazuje czytelny `IDEMPOTENCY_INCOMPLETE`.
7. Powtorz finish na zleceniu juz zakonczonym.
8. Oczekiwane: `TASK_ALREADY_FINISHED` nie zostawia martwego wpisu w kolejce.

## Bramki

```powershell
npm run verify:mobile-offline-conflicts
npm run test:offline-queue -w arbor-mobile
npm run verify:mobile
npm run test:scripts
npm test -w arbor-os -- tasks
```

## GO / NO-GO

GO:

- START/check-in/STOP, zdjecia, PROBLEM i finish maja stabilny idempotency key.
- Znane replay/conflict sa rozdzielone: `TASK_ALREADY_FINISHED` schodzi z kolejki, `IDEMPOTENCY_INCOMPLETE` zostaje do retry.
- Pending lokalny w szczegole zlecenia zachowuje prace, zdjecia, problemy i finish payload.

NO-GO:

- Kolejka dubluje zdjecia albo finish dla tego samego ID.
- Jeden konflikt blokuje flush pozostalych wpisow.
- Mobile gubi payload finish lub GPS startu po przejsciu offline.
