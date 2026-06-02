# Pilot launch index

Cel: jedna strona startowa dla zespolu przed realnym uruchomieniem pilota jednego oddzialu. Ten indeks mowi, co zmergowac, jakie komendy odpalic i gdzie zapisac decyzje GO / NO-GO.

## 1. Kolejnosc merge stacka

Zmerguj PR-y w tej kolejnosc, bo kazdy kolejny bazuje na poprzednim:

| PR | Zakres | Baza |
| --- | --- | --- |
| #39 | Kommo idempotency/retry/dead-letter contract | #38 |
| #40 | Pilot closure go-live gate | #39 |
| #41 | Pilot execution evidence template | #40 |
| #42 | Pilot run report generator | #41 |
| #43 | Pilot automated gates runner | #42 |
| #44 | Pilot decision linked to automated gates report | #43 |

Po merge stacka uruchom lokalnie:

```powershell
npm run verify:pilot-launch
npm run verify:pilot-execution
npm run verify:pilot-closure
npm run verify:scripts
```

## 2. Dane potrzebne przed proba

- Data proby pilota.
- Arbor OS URL.
- Arbor Web URL.
- Oddzial ID / nazwa.
- Kierownik testowy.
- Brygadzista testowy.
- Ekipy ID.
- Minimum 3 zlecenia testowe ID.
- Decyzja, czy Kommo i SMS/Zadarma sa wlaczone czy swiadomie wylaczone.
- Aktualny backup po migracjach.

## 3. Przygotowanie artefaktow

```powershell
cd C:\Users\paha1\arbor
npm run pilot:run:prepare -- --date YYYY-MM-DD
```

To tworzy `docs/pilot-runs/PILOT-GO-NO-GO-YYYY-MM-DD.md` i linkuje oczekiwany raport `docs/pilot-runs/PILOT-AUTOMATED-GATES-YYYY-MM-DD.md`.

## 4. Automatyczne bramki

Core run:

```powershell
npm run pilot:gates:run -- --date YYYY-MM-DD --continue-on-fail
```

Full run, jesli jest czas i srodowisko jest kompletne:

```powershell
npm run pilot:gates:run -- --date YYYY-MM-DD --full --continue-on-fail
```

Dodatkowo dla publicznego srodowiska:

```powershell
npm run smoke:p95 -- https://<arbor-os-url> --threshold 500 --samples 5
npm run smoke:web:tti -- https://<arbor-web-url> --threshold 3000
```

## 5. Manualny A-Z

Wypelnij w raporcie GO/NO-GO:

- wejscie zlecenia z Kommo albo reczne;
- Auto-dispatch i zapis planu;
- Harmonogram i cockpit Kierownika;
- mobile Brygadzisty;
- START z GPS;
- zdjecie Przed / problem / zdjecie Po;
- minimum jedna akcja offline i sync bez duplikatu;
- finish z materialami i kosztami;
- BI drill / marza przez role finansowa;
- Kommo outbound albo diagnostyka retry/dead-letter;
- SMS/Zadarma delivery albo swiadome wylaczenie;
- backup i restore dry-run.

## 6. Decyzja

GO podpisz tylko, jesli:

- `status:json:strict`, `check`, `verify:pilot-closure`, `verify:pilot-execution` i `smoke:critical-path` maja PASS;
- manualny A-Z przeszedl na minimum 3 zleceniach;
- RBAC nie przecieka finansow ani cudzych oddzialow;
- offline nie robi duplikatow i nie blokuje kolejki;
- Kommo/SMS maja diagnostyke albo sa jawnie wylaczone;
- backup i restore dry-run sa aktualne;
- wszystkie wyjatki maja wlasciciela i termin.

NO-GO wpisz, jesli ktorykolwiek warunek GO nie jest spelniony bez zaakceptowanego wyjatku.

## 7. Najkrotsza sciezka operacyjna

```powershell
cd C:\Users\paha1\arbor
npm run verify:pilot-launch
npm run pilot:run:prepare -- --date YYYY-MM-DD
npm run pilot:gates:run -- --date YYYY-MM-DD --continue-on-fail
```

Potem uzupelnij `docs/pilot-runs/PILOT-GO-NO-GO-YYYY-MM-DD.md` manualnym A-Z, wyjatkami i decyzja.
