# Pilot hardening - Kierownik + Brygadzista

Cel: przed startem jednego oddzialu potwierdzic, ze realny Kierownik i Brygadzista moga przejsc dzien pracy bez Excela, bez wycieku finansow do rol terenowych i bez blokady offline.

Zakres: web dla Kierownika, mobile dla Brygadzisty, backend `os` jako zrodlo prawdy, jeden oddzial, 3-5 zlecen testowych.

## 1. Bramka techniczna

Uruchom przed probnym dniem:

```powershell
cd C:\Users\paha1\arbor
npm run status:json:strict
npm run verify:pilot-hardening
npm run check
npm run verify:env-runbook
npm run smoke:critical-path
npm run smoke:operational
npm run smoke:field -w arbor-os
npm run test:offline-queue -w arbor-mobile
npm run smoke:routes -w arbor-web
```

Smoke mobile release:

```powershell
npm run smoke:mobile -w arbor-mobile
```

Uruchamiaj `smoke:mobile` wtedy, gdy sprawdzane sa ustawienia release albo build preview. Do szybkiej bramki pilota wystarcza `test:offline-queue`, `verify:mobile` z `npm run check` i manualny przebieg na telefonie.

## 2. Role i dane

### Kierownik oddzialu - web

- Loguje sie do web i widzi tylko zlecenia swojego oddzialu.
- Widzi cockpit Kierownika, raport ryzyk dnia, Auto-dispatch, Harmonogram i szczegol zlecenia.
- Moze poprawic plan, przypisac ekipe, wyslac SMS i obsluzyc akcje Kommo tylko w zakresie dozwolonym dla roli.
- Widzi branch-scoped `audit_log`: statusy, finish, decyzje operacyjne, SMS i rozliczenia bez wyjscia poza oddzial.
- Gdy `canViewFinance=false`, nie widzi wartosci netto, marzy, kosztow, BI financials ani eksportow finansowych.
- Widzi problem, zdjecia, START/STOP i finish po synchronizacji mobile.

### Brygadzista - mobile

- Loguje sie w mobile i widzi tylko przypisane zlecenia.
- Ma pobrana liste dzisiejszych zlecen i szczegoly przed testem slabej sieci.
- Wykonuje START z GPS, dodaje zdjecie "Przed", zglasza problem, dodaje zdjecie "Po" i robi STOP/finish.
- Wpisuje materialy i koszty operacyjne tylko w zakresie formularza finish.
- Offline zapisuje START, zdjecie/problem i finish do kolejki, a po powrocie sieci synchronizuje bez duplikatow.
- Powtorka requestu z tym samym `Idempotency-Key` nie tworzy drugiego work loga ani drugiego finish.
- Nie widzi finansow kierowniczych, SMS, Kommo, BI, audit_log ani paneli administracyjnych.

## 3. Przebieg A-Z

1. Kierownik tworzy albo odbiera zlecenie z Kommo, sprawdza klienta, adres, okno i oddzial.
2. Kierownik odpala Auto-dispatch i sprawdza preflight: konflikty ekipy, sprzetu, okna klienta i brakow GPS.
3. Kierownik zapisuje plan lub swiadomie uzywa bypassu, jesli blokada jest akceptowana w pilocie.
4. Brygadzista widzi zlecenie w mobile, robi START online.
5. Brygadzista przechodzi w tryb slabej sieci albo airplane mode, dodaje zdjecie/problem i robi co najmniej jedna akcje offline.
6. Po odzyskaniu sieci kolejka offline schodzi do zera albo pokazuje czytelny konflikt, np. `TASK_ALREADY_FINISHED`.
7. Kierownik widzi zsynchronizowane logi, zdjecia, problem i aktualny status.
8. Brygadzista wykonuje finish z kosztami materialow i operacyjnymi.
9. Kierownik sprawdza szczegol zlecenia, raport ryzyk, audit_log oraz brak wycieku finansow przy `canViewFinance=false`.
10. Dyrektor/Admin, poza przebiegiem Kierownika, potwierdza BI drill, marze i Kommo outbound package.

## 4. NO-GO blokady

NO-GO dla startu oddzialu:

- `npm run check` lub `npm run verify:pilot-hardening` nie przechodzi.
- Kierownik widzi lub edytuje finanse mimo `canViewFinance=false`.
- Brygadzista widzi finanse, SMS, Kommo, BI albo audit_log.
- Kierownik widzi zlecenia innego oddzialu bez roli Dyrektor/Admin.
- START/STOP/finish moze zgubic dane bez widocznego bledu.
- Offline queue tworzy duplikaty, blokuje sie na jednym wpisie albo nie raportuje konfliktu `IDEMPOTENCY_INCOMPLETE`.
- SMS albo Kommo sa wlaczone, ale bledy nie trafiaja do diagnostyki/retry/dead-letter.
- Brak backupu po migracjach albo brak sprawdzonego restore dry-run.

## 5. Artefakty z proby

Zapisz po przebiegu:

- wynik `npm run verify:pilot-hardening`;
- wynik `npm run check`;
- zrzut web z cockpitu Kierownika, Harmonogramu i szczegolu zlecenia bez finansow;
- zrzut mobile z lista zlecen, banerem kolejki offline i szczegolem po sync;
- ID zlecen testowych, ID oddzialu, ID ekipy i login testowych rol;
- eksport albo screenshot `audit_log` dla statusu, finish i rozliczenia;
- lista decyzji GO / NO-GO z wlascicielem i terminem.

## 6. GO

GO dla pilota jednego oddzialu:

- Kierownik i Brygadzista przechodza przebieg A-Z na minimum 3 zleceniach.
- Offline przechodzi START + zdjecie/problem + sync bez duplikatow.
- RBAC zgadza sie z macierza: Kierownik branch-scoped, Brygadzista field-only, Dyrektor/Admin finance.
- SMS, Kommo, audit_log i BI maja zielony smoke albo sa swiadomie wylaczone z wpisem w decyzjach.
- Backup i restore dry-run sa aktualne.
