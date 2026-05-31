# ARBOR pilot 1 oddzialu - checklist

Cel: sprawdzic, czy jeden oddzial moze przejsc caly dzien pracy w ARBOR bez Excela jako glownego narzedzia.

Zakres pilota: jedno srodowisko, jeden oddzial, realny kierownik, jedna lub dwie ekipy, kilka zlecen od wejscia do rozliczenia.

## 1. Bramka wejscia

- [ ] `npm run status:json:strict` przechodzi na srodowisku testowym albo produkcyjnym.
- [ ] `npm run check` przechodzi lokalnie przed wydaniem.
- [ ] `npm run verify:env-runbook` przechodzi po ostatnich zmianach env.
- [ ] `npm run verify:pilot-hardening` potwierdza checklisty, smoke i role Kierownik/Brygadzista.
- [ ] `npm run verify:observability` potwierdza health/ready/metrics, progi 5xx/p95 i storage smoke.
- [ ] `npm run deploy:prod:dry-run` potwierdza suchy przebieg env, migracji, backup/restore i smoke produkcyjnego.
- [ ] Backend `os` jest zrodlem prawdy dla API produkcyjnego.
- [ ] Jest utworzony admin, kierownik oddzialu i brygadzista testowy.
- [ ] Kierownik widzi tylko swoj oddzial, chyba ze ma role dyrektorska/admin.
- [ ] Publiczny `PUBLIC_BASE_URL` prowadzi do prawidlowej aplikacji.
- [ ] Zadarma/SMS albo fallback SMS jest skonfigurowany i ma test dostarczenia.
- [ ] Kommo jest skonfigurowane albo swiadomie wylaczone dla pilota.
- [ ] Backup bazy jest wykonany po migracjach i bootstrapie admina.
- [ ] Zespol wie, gdzie sa runbooki: `docs/ENVIRONMENT-RUNBOOK.md`, `docs/backup-restore.md`, `docs/MOBILE-OFFLINE-CONTRACT.md`.
- [ ] Zespol zna produkcyjny dry-run: `docs/PRODUCTION-DEPLOY-DRY-RUN.md`.
- [ ] Zespol zna minimum SLO i alertow: `docs/OBSERVABILITY-SLO-RUNBOOK.md`.
- [ ] Przebieg rolowy jest opisany w `docs/PILOT-HARDENING-KIEROWNIK-BRYGADZISTA.md`.

## 2. Dane startowe

- [ ] Oddzial ma uzupelniony kontakt, prog marzy i podstawowe ustawienia operacyjne.
- [ ] Sa co najmniej 2 ekipy z brygadzistami.
- [ ] Sa pojazdy/sprzet potrzebne do testu.
- [ ] Sa kompetencje albo swiadoma decyzja, ze w pilocie sa tylko ostrzezenia, nie twarde blokady.
- [ ] Sa 3-5 zlecen na jeden dzien: proste, z oknem czasowym, z ryzykiem/problemem, z kosztem materialow.
- [ ] Jedno zlecenie pochodzi z Kommo albo z recznego flow, ktore zastepuje Kommo w pilocie.

## 3. Scenariusz A-Z

### 3.1 Wejscie zlecenia

- [ ] Zlecenie powstaje z Kommo inbound albo recznie w ARBOR.
- [ ] Ma klienta, adres, miasto, opis zakresu i wartosc netto.
- [ ] Ma oddzial, priorytet, przewidywany czas, okno czasowe i wymagany sprzet/kompetencje, jesli dotyczy.
- [ ] Kierownik widzi zlecenie na liscie i w planie dnia.

### 3.2 Planowanie

- [ ] Auto-dispatch zwraca plan albo czytelne powody, dlaczego nie moze zaplanowac.
- [ ] Kierownik moze poprawic plan recznie.
- [ ] System blokuje lub ostrzega przed konfliktem ekipy, sprzetu i okna klienta.
- [ ] Harmonogram pokazuje zapisany plan.
- [ ] Ekipa widzi przypisane zlecenie w mobile.

### 3.3 Praca w terenie

- [ ] Brygadzista loguje sie w mobile.
- [ ] START zapisuje czas i GPS.
- [ ] Zdjecie "Przed" trafia do zlecenia.
- [ ] Problem z notatka i opcjonalnym zdjeciem trafia do kierownika.
- [ ] Zdjecie "Po" trafia do zlecenia.
- [ ] STOP/finish zapisuje czas, GPS, platnosc, materialy i koszty operacyjne.
- [ ] Powtorka requestu z tym samym `Idempotency-Key` nie tworzy duplikatu.

### 3.4 Offline

- [ ] Mobile ma pobrane dzisiejsze zlecenia przed testem slabej sieci.
- [ ] START bez sieci trafia do kolejki offline.
- [ ] Zdjecie/problem bez sieci trafia do kolejki offline.
- [ ] Po odzyskaniu sieci kolejka synchronizuje sie bez duplikatow.
- [ ] Kierownik widzi zsynchronizowane logi, zdjecia i problem.
- [ ] Konflikt, np. zlecenie zamkniete przed synchronizacja, ma czytelny komunikat i nie blokuje calej kolejki.

### 3.5 Rozliczenie i BI

- [ ] Zlecenie ma policzona marze ze wspolnego silnika kosztow.
- [ ] Kierownik widzi raport dzienny i ryzyka dnia.
- [ ] Dyrektor widzi oddzial w BI, marze i drill-down do zlecenia.
- [ ] Alert marzy ponizej progu pojawia sie dla zlecenia testowego z niska marza.
- [ ] Kommo outbound payload zawiera status, czas, zdjecia/dokumenty, koszty i marze albo zapisuje czytelny blad retry/dead-letter.

### 3.6 Klient

- [ ] Link statusowy klienta dziala tylko po tokenie.
- [ ] Link nie pokazuje danych finansowych ani wewnetrznych.
- [ ] SMS z linkiem statusowym albo propozycja okna czasowego jest wyslana przez skonfigurowany provider.
- [ ] Historia statusow jest widoczna publicznie w bezpiecznym zakresie.

## 4. Smoke automatyczny

Minimalna bramka przed dniem pilota:

```powershell
cd C:\Users\paha1\arbor
npm run status:json:strict
npm run verify:pilot-hardening
npm run check
npm run verify:env-runbook
npm run smoke:critical-path
npm run smoke:operational
```

Smoke offline/field, gdy pracujemy nad mobile:

```powershell
cd C:\Users\paha1\arbor
npm run smoke:field -w arbor-os
npm run verify:mobile
```

Smoke produkcyjny po deployu:

```powershell
cd C:\Users\paha1\arbor
npm run smoke:render -- https://<arbor-os-url>
```

## 5. GO / NO-GO

GO do pilota, jesli:

- [ ] Bramka wejscia jest zielona.
- [ ] Scenariusz A-Z przechodzi na co najmniej 3 zleceniach.
- [ ] Offline queue przechodzi minimum START + zdjecie/problem + sync.
- [ ] Kierownik potrafi sam znalezc zlecenie, problem, zdjecia, koszty i raport.
- [ ] Dyrektor widzi wynik oddzialu i drill-down.
- [ ] Jest aktualny backup i opis restore.

NO-GO, jesli:

- [ ] `npm run check` nie przechodzi.
- [ ] START/STOP albo finish potrafi zgubic dane bez widocznego bledu.
- [ ] Offline queue tworzy duplikaty lub blokuje sie na jednym wpisie.
- [ ] Kierownik moze zmieniac dane finansowe albo oddzial bez oczekiwanej roli.
- [ ] Nie ma sprawdzonego backupu po migracji.
- [ ] Kommo/SMS sa wlaczone, ale bledy integracji nie trafiaja do diagnostyki.

## 6. Najblizsze zadania po pierwszym przebiegu

- [ ] Zapisac realne problemy pilota w backlogu z priorytetem P0/P1.
- [ ] Ustalic, czy kompetencje w pilocie sa ostrzezeniem czy twarda blokada.
- [ ] Ustalic minimalny zestaw kosztow wymaganych przy finish.
- [ ] Ustalic, ktore role widza marze i eksporty.
- [ ] Uruchomic harmonogram backupow zgodnie z `docs/backup-restore.md`.
