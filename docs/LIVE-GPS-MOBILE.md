# ARBOR-OS Live GPS Mobile

## Cel

Live GPS ma pokazywac ostatnia znana pozycje brygadzisty albo wyceniajacego w harmonogramie, zeby biuro widzialo realny przebieg dnia i moglo szybciej planowac ogladziny oraz zlecenia.

## Zasada dzialania

- Aplikacja mobilna wysyla heartbeat do `POST /api/mobile/me/location`.
- Backend zapisuje rekord jako `provider = mobile` w `gps_vehicle_positions`.
- `GET /api/ekipy/live-locations` laczy pozycje Juwentus GPS z pozycjami z mobilki.
- Pozycje mobilne sa traktowane jako aktualne przez 12 godzin od `recorded_at`.

## Zakres prywatnosci i baterii

- Aktualnie dziala tryb foreground: telefon wysyla lokalizacje, kiedy aplikacja jest aktywna.
- Wysylka jest ograniczona do okolo 1 raz na minute albo po zmianie polozenia o 50 m.
- Role dopuszczone: `Brygadzista`, `Pomocnik`, `Wyceniajacy` / `Wyceniający`.
- Aplikacja pokazuje terenowym rolom widoczny status `GPS LIVE`, z ostatnia synchronizacja albo komunikatem o braku zgody/sieci.
- Pelny background GPS 24/7 wymaga osobnej decyzji, zgody pracownika, konfiguracji systemowej i polityki firmy.

## Payload

```json
{
  "lat": 50.06143,
  "lng": 19.93658,
  "accuracy_m": 12,
  "speed_kmh": 0,
  "heading": 90,
  "activity": "foreground",
  "platform": "android",
  "recorded_at": "2026-05-22T10:00:00.000Z"
}
```
