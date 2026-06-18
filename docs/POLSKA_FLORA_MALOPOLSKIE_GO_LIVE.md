# Polska Flora - Malopolskie go-live

## Cel

Oddzial Malopolskie ma byc gotowy do pracy na procesie: `Telefon / Ania -> CRM -> Ogledziny -> Wycena -> Ekipa`.

## Zasady operacyjne

- Ogledziny sa umawiane pon.-pt. 8-17.
- brak wycen przez telefon: Ania zbiera dane, proponuje termin ogledzin i zapisuje lead.
- Przypomnienia SMS ida po umowieniu ogledzin oraz przed wizyta.
- Klient trafia do CRM, a status i dane pracy synchronizuja sie z Kommo.
- Terminy specjalistow sa prowadzone w kalendarzu wycen.
- Plan ekip i sprzetu jest prowadzony w kalendarz zasobow.

## Integracje do sprawdzenia

- Webhook Ani: `/telephony/voice-agent/polska-flora/intake`.
- Sekret webhooka: `x-voice-agent-secret`.
- Kommo: konfiguracja statusow, pola leadow, idempotentny inbound `task.sync`.
- SMS: potwierdzenie ogledzin i przypomnienia SMS.
- kalendarz wycen: wolne terminy specjalistow ds. wyceny.
- Kalendarz zasobow: ekipy, sprzet, kolizje i plan dnia.

## GO

- Dashboard pokazuje sciezke `Telefon / Ania -> CRM -> Ogledziny -> Wycena -> Ekipa`.
- Testy webhooka Ani przechodza.
- Testy Kommo przechodza.
- `verify:resource-calendar-week` i `verify:resource-calendar-dnd` przechodza.
- `status:json:strict` pokazuje zdrowe API.

## NO-GO

- Brak sekretu webhooka Ani albo nieudany test intake.
- Kommo ma konflikty bez wlasciciela lub nie zapisuje inbound eventow.
- Kalendarz wycen pozwala umowic termin poza pon.-pt. 8-17 bez swiadomej decyzji kierownika.
- Przypomnienia SMS nie maja skonfigurowanego nadawcy oddzialu.
