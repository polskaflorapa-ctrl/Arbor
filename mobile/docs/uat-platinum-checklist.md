# UAT Checklist - Platinum Mobile

Krótka lista testowa przed wypuszczeniem zmian UI "Platinum".

## A. Preflight techniczny

- [ ] `npm run lint -w arbor-mobile`
- [ ] `npm run typecheck -w arbor-mobile`
- [ ] (opcjonalnie) `npm run smoke:api -w arbor-mobile`
- [ ] Brak nowych błędów w IDE (`ReadLints`)

## B. Smoke flow (10-15 min)

- [ ] Login działa (success i error state)
- [ ] Dashboard renderuje się poprawnie
- [ ] `ogledziny` działa + modal otwiera się poprawnie
- [ ] `wycena-kalendarz` działa + modal rezerwacji
- [ ] `zatwierdz-wyceny` działa + modal akceptacji
- [ ] Minimum 1 zapis akcji kończy się sukcesem

## C. Spójność Platinum (wizualnie)

- [ ] Brak "jasnych wysp" na dark theme
- [ ] Header i tabbar spójne na wszystkich ekranach
- [ ] Karty mają jednolite promienie i obrysy
- [ ] Overlaye modalowe mają ten sam styl (`rgba(5,8,15,...)`)
- [ ] CTA mają poprawny kontrast (`accent` + `accentText`)
- [ ] Badge/chipy statusowe czytelne i spójne

## D. Role i uprawnienia

Wykonać minimum dla 3 ról:

- [ ] Wyceniający
- [ ] Specjalista
- [ ] Kierownik / Admin

Dla każdej roli:

- [ ] wejście na dashboard
- [ ] wejście na 2-3 kluczowe ekrany
- [ ] brak "rozjechania" layoutu / stylu

## E. Krytyczne komponenty UI

- [ ] `ScreenHeader` wygląda spójnie na wszystkich ekranach
- [ ] `AppPrivacyLock` ma styl Platinum
- [ ] `OfflineQueueSync` banner spójny z theme
- [ ] Formularze: inputy, placeholdery, focus i błędy czytelne

## F. Manual screenshot baseline

Wykonać i zachować 6 screenshotów referencyjnych:

- [ ] Header (1 ekran)
- [ ] Karta listy (1 ekran)
- [ ] Modal z overlayem (1 ekran)
- [ ] Tabbar (1 ekran)
- [ ] Error/warning state (1 ekran)
- [ ] Formularz input/CTA (1 ekran)

## G. Final release gate

Wydanie "Platinum" gotowe, gdy:

- [ ] wszystkie sekcje A-F są odhaczone,
- [ ] brak blockerów P1/P0,
- [ ] zmiany są wypchnięte na `origin/master`,
- [ ] zespół akceptuje spójność "Platinum class".

