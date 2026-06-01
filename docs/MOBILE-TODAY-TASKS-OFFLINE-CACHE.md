# Mobile today's tasks offline cache

Cel: brygadzista ma plan dnia nawet przy slabej sieci, a aplikacja jasno mowi, kiedy pokazuje cache i kiedy trzeba odswiezyc dane po powrocie internetu.

## Kontrakt

- `saveTaskListCache` zapisuje liste z `/tasks/moje` albo `/tasks/wszystkie` po kazdym udanym pobraniu.
- `loadTodayTaskListCache` zwraca tylko zadania na lokalny dzisiejszy dzien.
- `TASK_LIST_CACHE_TTL_MS` wynosi 18 godzin, po tym czasie cache nie jest uzywany.
- `TASK_LIST_CACHE_STALE_MS` wynosi 15 minut, po tym czasie UI pokazuje komunikat `starsze niz 15 min - odswiez po powrocie sieci`.
- `zlecenia.tsx` i `misja-dnia.tsx` przy 5xx lub braku sieci przelaczaja widok na dzisiejsze zlecenia z cache.
- Po flush kolejki offline oba widoki robia recache przez ponowne `loadData`.

## Smoke manualny

1. Zaloguj brygadziste i otworz `Zlecenia` oraz `Misja dnia` online.
2. Sprawdz, ze widac dzisiejsze zlecenia.
3. Wylacz siec albo zasymuluj 5xx API.
4. Otworz ponownie oba widoki.
5. Oczekiwane: widok pokazuje tylko dzisiejsze zadania z cache i komunikat offline/cache.
6. Przywroc siec, zsynchronizuj kolejke offline i odswiez widok.
7. Oczekiwane: komunikat cache znika, a lista jest zapisana ponownie.

## Bramki

```powershell
npm run verify:mobile-today-cache
npm run test:offline-queue -w arbor-mobile
npm run verify:mobile
npm run test:scripts
```
