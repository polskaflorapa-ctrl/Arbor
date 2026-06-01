# Mobile problem/offline incident flow

Data: 2026-06-01

Cel: brygadzista moze zglosic problem z terenu, dodac zdjecie/notatke, pracowac bez sieci i miec pewnosc, ze kierownik zobaczy incydent po synchronizacji.

## Zakres

Flow dotyczy ekranu `mobile/app/zlecenie/[id].tsx`:

- zakladka `problemy`;
- przycisk `Zglos problem`;
- modal `Zglos problem`;
- typ problemu, opis/notatka i opcjonalne zdjecie problemu;
- kolejka offline dla `POST /api/tasks/:id/problemy`;
- kolejka offline dla `POST /api/tasks/:id/zdjecia`;
- pending UI `offline_pending`;
- powiadomienie kierownika po zapisie problemu w backendzie.

## Kontrakt mobile

Mobile wysyla problem:

```http
POST /api/tasks/:id/problemy
Idempotency-Key: task-<id>-problem-...
Content-Type: application/json

{
  "typ": "brak_dostepu",
  "opis": "Brama zamknieta, klient nie odbiera"
}
```

Gdy API zwroci 5xx albo request nie dojdzie, mobile uzywa `queueTaskProblemOffline` z `mobile/utils/offline-queue.ts`.

Wpis offline ma:

- stabilne `id` jako `Idempotency-Key`;
- `dedupeKey = problem:<id>`;
- `url = /tasks/:id/problemy`;
- `method = POST`;
- body `typ` i `opis`.

Na ekranie zlecenia `addPendingOfflineProblem` dopisuje lokalny problem ze statusem `Czeka na sync`, zeby brygadzista nie musial zgadywac, czy klikniecie sie zapisalo.

Zdjecie problemu idzie osobnym kanalem `queueTaskPhotoOffline` z tagami `problem,<typ>`. To pozwala flushowac problem i foto niezaleznie, bez mieszania JSON i multipart w jednym zadaniu kolejki.

## Kontrakt backendu

Backend `os/src/routes/tasks.js` przy `POST /api/tasks/:id/problemy`:

- respektuje `requireTaskAccess`;
- zuzywa `Idempotency-Key` przez `tryConsumeIdempotencyKey`;
- normalizuje typ przez `normalizeIssueTyp`;
- zapisuje `issues`;
- zwraca `issue`;
- tworzy `notifications` typu `Problem` dla `Prezes`, `Dyrektor`, `Administrator` oraz `Kierownik` tego samego `oddzial_id`;
- wysyla realtime `pushToUser` z `tab: "problemy"`;
- zwraca `notifications_created`.

## Manualny smoke

1. Wlacz mobile i otworz zlecenie przypisane do brygadzisty.
2. Wejdz w zakladke `Problemy`.
3. Otworz `Zglos problem`.
4. Wybierz typ `Brak dostepu`, wpisz notatke i dodaj zdjecie problemu.
5. W trybie online wyslij problem.
6. Kierownik powinien zobaczyc powiadomienie oraz problem w zleceniu.
7. Powtorz bez sieci: problem i zdjecie maja pojawic sie jako `Czeka na sync`.
8. Po odzyskaniu sieci flush kolejki ma wyslac problem bez duplikatu.

## Bramka

```powershell
npm run verify:mobile-problem-flow
npm run test:offline-queue -w arbor-mobile
npm test -w arbor-os -- tasks.test.js
npm run check
```

## GO / NO-GO

GO:

- problem online zapisuje `issues`;
- kierownik/admin dostaje `notifications` typu `Problem`;
- offline problem ma pending UI i przechodzi przez `queueTaskProblemOffline`;
- zdjecie problemu uzywa `queueTaskPhotoOffline` z tagiem `problem`;
- retry uzywa `Idempotency-Key`;
- testy mobile offline queue i backend tasks przechodza.

NO-GO:

- problem znika z UI przy braku sieci;
- flush tworzy duplikaty;
- kierownik nie ma powiadomienia po synchronizacji;
- zdjecie problemu blokuje zapis samego problemu;
- endpoint pozwala ominac `requireTaskAccess`.

