# ARBOR pilot 1 oddzialu - checklist

Cel: sprawdzic, czy jeden oddzial moze przejsc caly dzien pracy w ARBOR bez Excela jako glownego narzedzia.

Zakres pilota: jedno srodowisko, jeden oddzial, realny kierownik, jedna lub dwie ekipy, kilka zlecen od wejscia do rozliczenia.

## 1. Bramka wejscia

- [ ] `npm run status:json:strict` przechodzi na srodowisku testowym albo produkcyjnym.
- [ ] `npm run check` przechodzi lokalnie przed wydaniem.
- [ ] `npm run pilot:run:new -- --date YYYY-MM-DD` tworzy raport decyzji w `docs/pilot-runs/` przed realna proba.
- [ ] `npm run pilot:gates:run -- --date YYYY-MM-DD --continue-on-fail` zapisuje automatyczne PASS/FAIL do `docs/pilot-runs/`.
- [ ] `npm run verify:pilot-closure` potwierdza `PILOT-CLOSURE-GO-LIVE-GATE.md`: finalny smoke end-to-end, GO/NO-GO i komplet dowodow pilota.
- [ ] `npm run verify:pilot-execution` potwierdza `PILOT-GO-NO-GO-DECISION-TEMPLATE.md`: raport decyzji ma wyniki smoke, manualny A-Z, wyjatki, ownerow i podpis.
- [ ] `npm run verify:env-runbook` przechodzi po ostatnich zmianach env.
- [ ] `npm run verify:pilot-hardening` potwierdza checklisty, smoke i role Kierownik/Brygadzista.
- [ ] `npm run verify:rbac-scope` potwierdza role, `oddzial_id`, team scope, ukrycie finansow i web route guards.
- [ ] `npm run verify:observability` potwierdza health/ready/metrics, progi 5xx/p95 i storage smoke.
- [ ] `npm run verify:incident-runbook` potwierdza reakcje na down API, p95, storage, Kommo/SMS i restore.
- [ ] `npm run verify:kommo-sms-drill` potwierdza drill Kommo dead-letter, retry i SMS delivery fallback.
- [ ] `npm run verify:kommo-idempotency-retry` potwierdza `KOMMO-IDEMPOTENCY-RETRY-DEADLETTER-CONTRACT.md`: outbound retry/dead-letter, inbound idempotency i konflikty w diagnostyce.
- [ ] `npm run verify:backup-rpo` potwierdza RPO/RTO, retencje, restore drill i artefakty backupu.
- [ ] `npm run verify:web-tti` potwierdza prog TTI panelu i komendy smoke web.
- [ ] `npm run verify:scale-readiness` potwierdza horizontal scaling: JWT, S3, Redis login limiter, crony i DB pool.
- [ ] `npm run verify:dispatcher-adr` potwierdza decyzje OR-Tools/self-hosted, fallback `arbor-clarke-wright`, koszt API i limity Google/Mapbox.
- [ ] `npm run verify:resource-calendar-week` potwierdza tygodniowy kalendarz ekip, krytycznego sprzetu i rezerwacji.
- [ ] `npm run verify:resource-calendar-dnd` potwierdza drag & drop zlecen miedzy slotami, zapis planu do API i blokady kolizji.
- [ ] `npm run verify:planning-map` potwierdza mape planistyczna z pinezkami zlecen, pozycjami ekip live i przejsciem do kalendarza zasobow.
- [ ] `npm run verify:equipment-cards` potwierdza karty pojazdow/sprzetu z przegladem, OC, alertami i najblizsza rezerwacja w Flocie.
- [ ] `npm run verify:dispatcher-day-plan` potwierdza wczytanie zapisanego planu dispatchera do harmonogramu/cockpitu i zastosowanie go w panelu kierownika.
- [ ] `npm run verify:machine-cards-crud` potwierdza CRUD kart maszyn, przypisanie do ekipy/oddzialu i scope oddzialu.
- [ ] `npm run verify:machine-usage-blocks` potwierdza `MACHINE-USAGE-BLOCKS-CONTRACT.md`: przypomnienia przegladow/OC/motogodzin i blokade uzycia sprzetu po terminie.
- [ ] `npm run verify:material-inventory` potwierdza `MATERIAL-INVENTORY-CONTRACT.md`: stany materialow, przyjecia i rozchod na zlecenie.
- [ ] `npm run verify:mobile-inventory-usage` potwierdza `MOBILE-INVENTORY-USAGE-CONTRACT.md`: finish z `material_id` robi rozchod magazynu i blokuje brak stanu.
- [ ] `npm run verify:worklog-time-ledger` potwierdza `WORKLOG-TIME-LEDGER-CONTRACT.md`: automatyczna ECP z work logow, branch scope i robocza regule nadgodzin.
- [ ] `npm run verify:credential-expiry-cards` potwierdza `CREDENTIAL-EXPIRY-CARDS-CONTRACT.md`: karty pracownika i HR pokazują wygasle/wygasajace uprawnienia.
- [ ] `npm run verify:competency-assignment-guard` potwierdza `COMPETENCY-ASSIGNMENT-GUARD-CONTRACT.md`: reczne przypisanie zlecenia blokuje ekipe bez wymaganych kompetencji.
- [ ] `npm run verify:dispatch-competency-guard` potwierdza `DISPATCH-COMPETENCY-GUARD-CONTRACT.md`: zapisany plan dispatchera nie omija twardej blokady kompetencji.
- [ ] `npm run verify:mobile-problem-flow` potwierdza PROBLEM w mobile, pending offline, zdjecie problemu i powiadomienie kierownika.
- [ ] `npm run verify:mobile-photo-enforcement` potwierdza blokade finish bez wymaganych zdjec Przed/Po.
- [ ] `npm run verify:mobile-before-after-photo` potwierdza konfiguracje per oddzial i offline pending dla zdjec Przed/Po.
- [ ] `npm run verify:mobile-material-cost-flow` potwierdza raport materialow, paliwa/utylizacji i pending offline finish.
- [ ] `npm run verify:mobile-today-cache` potwierdza liste dzisiejszych zlecen offline, TTL i recache po sync.
- [ ] `npm run verify:mobile-offline-conflicts` potwierdza idempotency, retry i konflikty kolejki offline.
- [ ] `npm run verify:mobile-start-stop-edge` potwierdza START/STOP work log, GPS, aktywny log i podwojne START/STOP.
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
- [ ] Zespol zna finalna bramke go-live pilota: `docs/PILOT-CLOSURE-GO-LIVE-GATE.md`.
- [ ] Zespol zna szablon decyzji pilota: `docs/PILOT-GO-NO-GO-DECISION-TEMPLATE.md`.
- [ ] Zespol zna minimum SLO i alertow: `docs/OBSERVABILITY-SLO-RUNBOOK.md`.
- [ ] Zespol zna runbook incydentow: `docs/PRODUCTION-INCIDENT-RUNBOOK.md`.
- [ ] Zespol zna RBAC/branch scope: `docs/RBAC-BRANCH-SCOPE-AUDIT.md`.
- [ ] Zespol zna decyzje dispatchera: `docs/DISPATCHER-ARCHITECTURE-DECISION.md`.
- [ ] Zespol zna kalendarz zasobow: `docs/RESOURCE-CALENDAR-WEEKLY-CONTRACT.md`.
- [ ] Zespol zna drag & drop kalendarza: `docs/RESOURCE-CALENDAR-DRAG-DROP-CONTRACT.md`.
- [ ] Zespol zna mape planistyczna: `docs/PLANNING-MAP-CONTRACT.md`.
- [ ] Zespol zna karty zasobow: `docs/EQUIPMENT-CARDS-CONTRACT.md`.
- [ ] Zespol zna wczytanie planu dispatchera: `docs/DISPATCHER-DAY-PLAN-LOAD-CONTRACT.md`.
- [ ] Zespol zna CRUD kart maszyn: `docs/MACHINE-CARDS-CRUD-CONTRACT.md`.
- [ ] Zespol zna flow PROBLEM/offline: `docs/MOBILE-PROBLEM-OFFLINE-FLOW.md`.
- [ ] Zespol zna blokade zdjec Przed/Po: `docs/MOBILE-BEFORE-AFTER-PHOTO-ENFORCEMENT.md`.
- [ ] Zespol zna cache listy dnia: `docs/MOBILE-TODAY-TASKS-OFFLINE-CACHE.md`.
- [ ] Zespol zna raport zuzycia materialow/kosztow offline: `docs/MOBILE-MATERIAL-OFFLINE-COST-FLOW.md`.
- [ ] Zespol zna konflikty/idempotency mobile offline: `docs/MOBILE-OFFLINE-CONFLICT-IDEMPOTENCY.md`.
- [ ] Zespol zna START/STOP work log edge cases: `docs/MOBILE-START-STOP-WORKLOG-EDGE-CASES.md`.
- [ ] Zespol zna RPO/RTO i restore drill: `docs/BACKUP-RPO-RTO-RUNBOOK.md`.
- [ ] Zespol zna drill integracji: `docs/KOMMO-SMS-INCIDENT-DRILL.md`.
- [ ] Zespol zna kontrakt Kommo idempotency/retry/dead-letter: `docs/KOMMO-IDEMPOTENCY-RETRY-DEADLETTER-CONTRACT.md`.
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
npm run pilot:run:new -- --date YYYY-MM-DD
npm run pilot:gates:run -- --date YYYY-MM-DD --continue-on-fail
npm run status:json:strict
npm run verify:pilot-closure
npm run verify:pilot-execution
npm run verify:dispatcher-adr
npm run verify:resource-calendar-week
npm run verify:resource-calendar-dnd
npm run verify:planning-map
npm run verify:equipment-cards
npm run verify:dispatcher-day-plan
npm run verify:machine-cards-crud
npm run verify:mobile-problem-flow
npm run verify:mobile-before-after-photo
npm run verify:mobile-photo-enforcement
npm run verify:mobile-material-cost-flow
npm run verify:mobile-today-cache
npm run verify:mobile-offline-conflicts
npm run verify:mobile-start-stop-edge
npm run verify:rbac-scope
npm run verify:kommo-idempotency-retry
npm run verify:pilot-hardening
npm run check
npm run verify:env-runbook
npm run smoke:critical-path
npm run smoke:operational
npm run smoke:p95 -- https://<arbor-os-url> --threshold 500 --samples 5
npm run smoke:web:tti -- https://<arbor-web-url> --threshold 3000
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
- [ ] P95 smoke po publicznym URL przechodzi pod progiem 500 ms.
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
