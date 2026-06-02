# Pilot GO / NO-GO decision - 2026-06-02

Cel: zapisac wynik realnego uruchomienia finalnych smoke i manualnego przebiegu A-Z przed startem pilota jednego oddzialu. Artefakt utworzony z szablonu w dniu 2026-06-02.

## 1. Metadane proby

- Data: 2026-06-02
- Srodowisko: local
- Arbor OS URL: http://localhost:3001
- Arbor Web URL: http://localhost:3000 albo http://localhost:3002
- Oddzial ID / nazwa:
- Kierownik testowy:
- Brygadzista testowy:
- Ekipy ID:
- Zlecenia testowe ID:
- Wlasciciel decyzji:
- Automatyczne bramki: docs/pilot-runs/PILOT-AUTOMATED-GATES-2026-06-02.md

## 2. Wyniki automatycznych bramek

Wpisz `PASS`, `FAIL`, `SKIP` albo `EXCEPTION`.

| Bramka | Wynik | Artefakt / link / komentarz |
| --- | --- | --- |
| `npm run status:json:strict` | PASS | `docs/pilot-runs/PILOT-AUTOMATED-GATES-2026-06-02.md` |
| `npm run verify:pilot-closure` | PASS | `docs/pilot-runs/PILOT-AUTOMATED-GATES-2026-06-02.md` |
| `npm run verify:pilot-hardening` | PASS | `docs/pilot-runs/PILOT-AUTOMATED-GATES-2026-06-02.md` |
| `npm run verify:rbac-scope` | PASS | `docs/pilot-runs/PILOT-AUTOMATED-GATES-2026-06-02.md` |
| `npm run verify:kommo-idempotency-retry` | PASS | `docs/pilot-runs/PILOT-AUTOMATED-GATES-2026-06-02.md` |
| `npm run verify:kommo-sms-drill` | PASS | `docs/pilot-runs/PILOT-AUTOMATED-GATES-2026-06-02.md` |
| `npm run verify:backup-rpo` | PASS | `docs/pilot-runs/PILOT-AUTOMATED-GATES-2026-06-02.md` |
| `npm run verify:observability` | PASS | `docs/pilot-runs/PILOT-AUTOMATED-GATES-2026-06-02.md` |
| `npm run verify:web-tti` | PASS | `docs/pilot-runs/PILOT-AUTOMATED-GATES-2026-06-02.md` |
| `npm run check` | SKIP | Nie uruchomione w core gate. |
| `npm run smoke:critical-path` | PASS | `docs/pilot-runs/PILOT-AUTOMATED-GATES-2026-06-02.md` |
| `npm run smoke:operational` | SKIP | Nie uruchomione w core gate. |
| `npm run smoke:demo:e2e` | SKIP | Nie uruchomione w core gate. |
| `npm run deploy:prod:dry-run` |  |  |
| `npm run smoke:p95 -- https://<arbor-os-url> --threshold 500 --samples 5` | SKIP | Wymaga publicznego/docelowego URL albo osobnego lokalnego smoke. |
| `npm run smoke:web:tti -- https://<arbor-web-url> --threshold 3000` | SKIP | Wymaga publicznego/docelowego URL albo osobnego lokalnego smoke. |
| `npm run verify:mobile` | SKIP | Nie uruchomione w core gate. |
| `npm run smoke:mobile -w arbor-mobile` | SKIP | Nie uruchomione w core gate. |

## 3. Manualny przebieg A-Z

| Krok | Wynik | Dowod / komentarz |
| --- | --- | --- |
| Zlecenie weszlo z Kommo albo recznie |  |  |
| Auto-dispatch zaplanowal albo pokazal blokady |  |  |
| Plan jest widoczny w Harmonogramie i cockpitcie |  |  |
| Brygadzista widzi zlecenie w mobile |  |  |
| START z GPS zapisany |  |  |
| Zdjecie Przed zapisane |  |  |
| Problem zapisany i widoczny dla Kierownika |  |  |
| Zdjecie Po zapisane |  |  |
| Akcja offline zsynchronizowana bez duplikatu |  |  |
| Finish z materialami i kosztami zapisany |  |  |
| BI drill / marza sprawdzona przez role finansowa |  |  |
| Kommo outbound albo diagnostyka retry sprawdzona |  |  |
| SMS/Zadarma dostarczenie albo wylaczenie zapisane |  |  |
| Backup i restore dry-run potwierdzone |  |  |

## 4. Wyjatki

Kazdy `SKIP`, `FAIL` albo `EXCEPTION` musi miec wlasciciela, termin i decyzje.

| Obszar | Powod | Ryzyko | Wlasciciel | Termin | Decyzja |
| --- | --- | --- | --- | --- | --- |
| Manualny A-Z | Brak oddzialu, ekip, kont i minimum 3 zlecen testowych | Nie mozna podpisac GO dla pilota biznesowego | TBD | TBD | NO-GO do czasu uzupelnienia danych pilota |

## 5. Kryteria decyzji

GO mozna podpisac tylko, gdy:

- `status:json:strict`, `check`, `verify:pilot-closure` i `smoke:critical-path` maja `PASS`;
- manualny przebieg A-Z przeszedl na minimum 3 zleceniach;
- RBAC nie pokazal wycieku finansow ani cudzych oddzialow;
- offline nie utworzyl duplikatow i nie zablokowal kolejki;
- Kommo/SMS sa zielone albo wylaczone z jawna decyzja;
- backup i restore dry-run sa aktualne;
- wszystkie wyjatki maja wlasciciela i termin.

NO-GO wpisz, jesli ktorykolwiek warunek GO nie jest spelniony bez zaakceptowanego wyjatku.

## 6. Decyzja

- Decyzja: `NO-GO`
- Uzasadnienie: Automatyczne core gate lokalnie przeszly, ale manualny A-Z nie zostal wykonany, bo brakuje oddzialu, kont Kierownik/Brygadzista, ekip i minimum 3 zlecen testowych.
- Wlasciciel pilota:
- Data i godzina podpisu:
- Nastepny krok: Uzupelnic dane pilota i uruchomic manualny A-Z albo full gate na docelowym srodowisku.
