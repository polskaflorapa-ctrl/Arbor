# Planning map contract

Cel: kierownik ma jeden widok mapy planistycznej, w ktorym widzi pinezki zlecen, ostatnie pozycje ekip i szybkie przejscie do kalendarza zasobow.

## Zakres

- Widok: `#/mapa-live`.
- Dane zlecen: `GET /api/tasks/wszystkie`, pola `pin_lat`, `pin_lng`, `data_planowana`, `godzina_rozpoczecia`, `ekipa_id`.
- Dane live ekip: `GET /api/ekipy/live-locations`, zrodla `mobile` i `juwentus`.
- Kalendarz planowania: `#/kalendarz-zasobow?date=YYYY-MM-DD&task=ID&modal=1`.

## GO

- Mapa rysuje pinezki zlecen z `pin_lat/pin_lng`.
- Mapa rysuje live pozycje ekip i wyceniajacych z `/ekipy/live-locations`.
- Jezeli zlecenie ma przypisana ekipe i live GPS, widok rysuje schematyczna linie ekipa -> zlecenie.
- Klik pinezki zlecenia wybiera temat w panelu decyzji.
- Przycisk `Kalendarz` otwiera `KalendarzZasobow` z data, task id i modalem planowania.

## NO-GO

- Brak `pin_lat/pin_lng` nie moze blokowac calej mapy.
- Brak live GPS nie ukrywa zlecenia z mapy, jesli ma pinezke.
- Link do mapy Google uzywa tylko koordynatow, bez danych finansowych.
- Kierownik oddzialu dostaje dane live ograniczone backendowym branch scope.

## Automatyczna bramka

```powershell
npm run verify:planning-map
npm test -w arbor-web -- MapaLive.test.js
```
