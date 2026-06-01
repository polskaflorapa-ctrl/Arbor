# Mobile before/after photo enforcement

Cel: brygadzista nie zamyka zlecenia bez kompletu zdjec `Przed` i `Po`, gdy oddzial ma wlaczona twarda regule pilota.

## Konfiguracja

- Globalnie dla wszystkich oddzialow:
  - `TASK_FINISH_REQUIRE_PRZED_PHOTO=1`
  - `TASK_FINISH_REQUIRE_PO_PHOTO=1`
- Per oddzial:
  - `TASK_FINISH_REQUIRE_PRZED_PHOTO_BRANCHES=1,2`
  - `TASK_FINISH_REQUIRE_PO_PHOTO_BRANCHES=1,2`

Globalne flagi maja pierwszenstwo. Listy oddzialow sa rozdzielane przecinkiem, spacja albo srednikiem.

## Kontrakt backendu

- `GET /api/tasks/:id` zwraca `finish_requirements`:
  - `require_przed_photo`
  - `require_po_photo`
  - `has_przed_photo`
  - `has_po_photo`
- `POST /api/tasks/:id/finish` dla roli ekipy odrzuca finish:
  - `TASK_FINISH_PRZED_PHOTO_REQUIRED`, gdy brakuje minimum `FINISH_PHOTO_MIN.przed`
  - `TASK_FINISH_PO_PHOTO_REQUIRED`, gdy brakuje minimum `FINISH_PHOTO_MIN.po`
- Minimum jest wspolne dla backendu i mobile: `FINISH_PHOTO_MIN = { przed: 2, po: 2 }`.
- Wartosci kontrolne dla smoke: `FINISH_PHOTO_MIN.przed = 2`, `FINISH_PHOTO_MIN.po = 2`.

## Kontrakt mobile

- Mobile liczy zdjecia lokalne i serwerowe, w tym `offline_pending`.
- `queueTaskPhotoOffline` zachowuje typ `przed` lub `po`, wiec zdjecie zrobione bez sieci od razu odblokowuje lokalny UX.
- Ekran finish pokazuje osobne pozycje checklisty:
  - `Zdjecia przed praca`
  - `Zdjecia po pracy`
- Akcja `Zakoncz` kieruje operatora najpierw do brakujacego `Przed`, potem do brakujacego `Po`.

## Manualny smoke

1. Ustaw `TASK_FINISH_REQUIRE_PRZED_PHOTO_BRANCHES=<oddzial_pilota>` i `TASK_FINISH_REQUIRE_PO_PHOTO_BRANCHES=<oddzial_pilota>`.
2. Zaloguj sie jako brygadzista z tego oddzialu.
3. Otworz zlecenie w statusie `W_Realizacji`.
4. Bez zdjec kliknij `Zakoncz`: oczekiwany blok `Przed`.
5. Dodaj 2 zdjecia `Przed`, w tym jedno w airplane mode.
6. Kliknij `Zakoncz`: oczekiwany blok `Po`.
7. Dodaj 2 zdjecia `Po`, w tym jedno w airplane mode.
8. Sprawdz, ze finish modal ma zielone pozycje `Przed` i `Po`.
9. Po odzyskaniu sieci kolejka synchronizuje zdjecia bez duplikatow.

## GO

- `npm run verify:mobile-before-after-photo` przechodzi.
- `npm run smoke:mobile -w arbor-mobile` przechodzi.
- `npm test -w arbor-os -- tasks` przechodzi po zmianach backendu.
- Kierownik widzi zdjecia `Przed` i `Po` przy zleceniu po synchronizacji offline.

## NO-GO

- `finish_requirements` nie zwraca flag per oddzial.
- Mobile pozwala otworzyc finish bez brakujacego `Przed` lub `Po` przy wlaczonej regule.
- Offline pending zdjecia nie sa widoczne lokalnie albo nie trafiaja do kolejki.
- Backend akceptuje finish ekipy mimo wlaczonej reguly i brakujacych zdjec.
