# Dispatch PRO - Go-Live One Pager

Krotka checklista na start pracy zespolu (wyceniajacy, specjalista, brygadzista).

## 1) Start dnia (2 min)

- [ ] Backend i web/mobile dzialaja.
- [ ] GPS ekip jest aktualny (brak masowych sygnalow >15 min).
- [ ] Wyceny i ekipy sa widoczne w kalendarzu.

## 2) Wyceniajacy - zasada pracy

- [ ] Dodaj/uzupelnij wycene.
- [ ] Kliknij `Rezerwuj termin ekipy`.
- [ ] Wybieraj najpierw sloty z ETA.
- [ ] Zapisz rezerwacje wstepna.

Priorytet:
1. Slot z ETA <= prog (20/25/30 min),
2. potem najlepszy slot z ETA,
3. na koncu slot bez ETA (tylko awaryjnie).

## 3) Specjalista - zasada zatwierdzania

- [ ] Wejdz w `rezerwacja_wstepna` / `do_specjalisty`.
- [ ] Sprawdz ekipe, date i godzine (prefill).
- [ ] Zatwierdz tylko bez konfliktu.
- [ ] Przy konflikcie wybierz inny slot i zatwierdz ponownie.

## 4) Czerwone flagi (nie ignorowac)

- [ ] `Brak pinezki klienta` -> uzupelnij lokalizacje.
- [ ] `Brak GPS ekipy` -> sprawdz przypisanie pojazdu/GPS.
- [ ] `Stary GPS (X min)` -> traktuj ETA ostroznie.

## 5) Definicja "OK"

Proces jest poprawny, gdy:
- [ ] wyceniajacy zapisuje rezerwacje bez bledow,
- [ ] specjalista zatwierdza i tworzy/aktualizuje task,
- [ ] nie ma podwojnych rezerwacji tej samej ekipy,
- [ ] sloty z ETA sa domyslnie preferowane.

## 6) Szybkie awarie - co robic

Brak ETA:
- [ ] sprawdz pin klienta,
- [ ] sprawdz GPS ekipy,
- [ ] zmien prog ETA i porownaj sloty.

Brak mozliwosci zatwierdzenia:
- [ ] to zwykle konflikt terminu,
- [ ] wybierz nastepny slot i ponow zatwierdzenie.

## 7) Ustawienie rekomendowane

- Prog ETA: **25 min** (domyslnie).
- W dniach duzego oblozenia: **30 min**.
- W dniach krytycznych czasowo: **20 min**.
