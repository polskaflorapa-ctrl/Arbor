# Dispatch PRO - UAT i Runbook operacyjny

Ten dokument jest praktycznym przewodnikiem do wdrozenia nowego modelu planowania:
- rezerwacja wstepna terminu ekipy przez wyceniajacego,
- podpowiedzi slotow z ETA/GPS,
- zatwierdzenie przez specjaliste.

## 1) Warunki startowe (checklista techniczna)

- [ ] Wykonana migracja SQL z `os/migrate.sql`.
- [ ] Backend `os` zrestartowany po migracji.
- [ ] Endpointy dzialaja:
  - [ ] `GET /api/wyceny/availability/slots`
  - [ ] `POST /api/wyceny/:id/rezerwuj-termin`
  - [ ] `POST /api/wyceny/:id/zatwierdz`
- [ ] Dla ekip sa aktualne dane GPS (Juwentus) lub swiadomie testujemy scenariusze bez GPS.

## 2) UAT end-to-end (scenariusz glowny)

### Krok A - utworzenie wyceny
- [ ] W kalendarzu wycen utworz nowa wycene.
- [ ] Ustaw ekipe, date i godzine.
- [ ] Zapisz wycene.

Oczekiwane:
- Wycena ma status `oczekuje`.

### Krok B - rezerwacja terminu przez wyceniajacego
- [ ] Otworz wycene i kliknij `Rezerwuj termin ekipy`.
- [ ] Sprawdz sekcje slotow:
  - sloty z ETA sa na gorze,
  - sloty bez ETA sa nizej (nizszy priorytet).
- [ ] Zmien prog ETA (20/25/30 min) i potwierdz, ze auto-wybor godziny sie aktualizuje.
- [ ] Zapisz rezerwacje.

Oczekiwane:
- Status przechodzi na `rezerwacja_wstepna`.
- Pokazuje sie komunikat o rezerwacji i oczekiwaniu na specjaliste.

### Krok C - zatwierdzenie przez specjaliste
- [ ] Przejdz do ekranu zatwierdzania wycen.
- [ ] Otworz filtr `rezerwacja_wstepna` lub `do_specjalisty`.
- [ ] Sprawdz prefill (ekipa/data/godzina z rezerwacji).
- [ ] Kliknij zatwierdzenie.

Oczekiwane:
- Powstaje/aktualizuje sie task.
- Status wyceny przechodzi na `zatwierdzono`.

### Krok D - walidacja konfliktu
- [ ] Dla tej samej ekipy zarezerwuj kolidujacy termin na innej wycenie.
- [ ] Sprobuj zapisac rezerwacje lub zatwierdzic kolizje.

Oczekiwane:
- API blokuje operacje konfliktem (brak podwojnej rezerwacji).

## 3) UAT diagnostyczny (jakosc danych ETA)

### Brak pinezki klienta
- [ ] Utworz/edytuj wycene bez `lat/lon` i bez pinu taska.
- [ ] Otworz modal rezerwacji.

Oczekiwane:
- Widoczne `brak pinezki klienta`.
- Sloty moga byc bez ETA.

### Brak GPS ekipy
- [ ] Wybierz ekipe bez sygnalu GPS.
- [ ] Otworz modal rezerwacji.

Oczekiwane:
- Widoczne `brak sygnalu GPS ekipy`.
- Sloty z ETA nie sa dostepne.

### Stary GPS
- [ ] Pracuj na ekipie z sygnalem starszym niz 15 minut.

Oczekiwane:
- Widoczne ostrzezenie `Stary GPS (X min)`.

## 4) Runbook operacyjny (codzienna praca)

1. Wyceniajacy tworzy wycene i od razu rezerwuje termin ekipy.
2. System podpowiada sloty:
   - preferencja slotow z ETA,
   - fallback na sloty bez ETA.
3. Specjalista zatwierdza rezerwacje.
4. Po zatwierdzeniu zadanie trafia do harmonogramu ekipy.

Zalecenia:
- Uzywaj progu ETA 25 min jako domyslnego.
- Przy przeciazeniu dnia zmien prog na 30 min.
- Gdy brakuje ETA, najpierw popraw dane (pin klienta lub GPS ekipy).

## 5) Szybkie debugowanie

Jesli ranking slotow wyglada niepoprawnie:
- sprawdz `eta_unavailable_reason` z endpointu slots,
- sprawdz czy wycena ma `lat/lon` lub task ma `pin_lat/pin_lng`,
- sprawdz aktualnosc GPS ekipy (`team_gps_age_min`),
- potwierdz brak konfliktu czasowego w tym samym przedziale.
