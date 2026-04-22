# DISPATCH PRO - CHECKLISTA A4 (DO WYDRUKU)

Data: ____________________    Zmiana: ____________________    Koordynator: ____________________

---

## 1. START DNIA (KOORDYNATOR) - 2 MIN

- [ ] API + web + mobile dzialaja
- [ ] GPS ekip aktualny (brak masowych sygnalow >15 min)
- [ ] Kalendarz wycen i lista ekip widoczne
- [ ] Statusy `rezerwacja_wstepna` / `do_specjalisty` dostepne

---

## 2. WYCENIAJACY - PROCEDURA

1) Utworz / uzupelnij wycene  
2) Kliknij **Rezerwuj termin ekipy**  
3) Najpierw wybieraj sloty z ETA  
4) Zapisz rezerwacje wstepna

### Kolejnosc decyzji

1. Slot z ETA <= prog (20/25/30 min)  
2. Potem najlepszy slot z ETA  
3. Slot bez ETA tylko awaryjnie

---

## 3. SPECJALISTA - PROCEDURA AKCEPTACJI

1) Wejdz w `rezerwacja_wstepna` lub `do_specjalisty`  
2) Sprawdz prefill: ekipa + data + godzina  
3) Kliknij zatwierdzenie  
4) Zweryfikuj, czy powstal/odswiezyl sie task

### Jesli blad/kolizja

- [ ] to zwykle konflikt terminu
- [ ] wybierz kolejny slot i zatwierdz ponownie

---

## 4. BRYGADZISTA - CO MA SIE ZGADZAC

- [ ] Task ma poprawna date i godzine
- [ ] Task ma poprawnie przypisana ekipe
- [ ] Brak duplikatow i podwojnych rezerwacji
- [ ] Nawigacja/adres klienta jest czytelny

---

## 5. CZERWONE FLAGI (REAKCJA NATYCHMIAST)

- [ ] **Brak pinezki klienta** -> uzupelnij lokalizacje
- [ ] **Brak GPS ekipy** -> sprawdz przypisanie auta/GPS
- [ ] **Stary GPS (X min)** -> traktuj ETA ostroznie

---

## 6. USTAWIENIA REKOMENDOWANE

- Standard: **ETA 25 min**
- Duze oblozenie dnia: **ETA 30 min**
- Dzien krytyczny czasowo: **ETA 20 min**

---

## 7. DEFINICJA „GO-LIVE OK”

Go-live jest poprawny, jesli:

- [ ] wyceniajacy zapisuje rezerwacje bez bledow
- [ ] specjalista zatwierdza i tworzy/aktualizuje task
- [ ] system blokuje kolizje terminow
- [ ] sloty z ETA sa preferowane automatycznie

---

## 8. PODPISY

Wyceniajacy: ____________________  
Specjalista: ____________________  
Brygadzista: ____________________  
Koordynator zmiany: ____________________
