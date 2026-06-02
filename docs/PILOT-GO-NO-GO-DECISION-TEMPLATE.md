# Pilot GO / NO-GO decision template

Cel: zapisac wynik realnego uruchomienia finalnych smoke i manualnego przebiegu A-Z przed startem pilota jednego oddzialu. Ten plik jest szablonem; po probie skopiuj go do artefaktu z data, np. `docs/pilot-runs/PILOT-GO-NO-GO-2026-06-02.md`.

## 1. Metadane proby

- Data:
- Srodowisko:
- Arbor OS URL:
- Arbor Web URL:
- Oddzial ID / nazwa:
- Kierownik testowy:
- Brygadzista testowy:
- Ekipy ID:
- Zlecenia testowe ID:
- Wlasciciel decyzji:
- Automatyczne bramki:

## 2. Wyniki automatycznych bramek

Wpisz `PASS`, `FAIL`, `SKIP` albo `EXCEPTION`.

| Bramka | Wynik | Artefakt / link / komentarz |
| --- | --- | --- |
| `npm run status:json:strict` |  |  |
| `npm run verify:pilot-closure` |  |  |
| `npm run verify:pilot-hardening` |  |  |
| `npm run verify:rbac-scope` |  |  |
| `npm run verify:kommo-idempotency-retry` |  |  |
| `npm run verify:kommo-sms-drill` |  |  |
| `npm run verify:backup-rpo` |  |  |
| `npm run verify:observability` |  |  |
| `npm run verify:web-tti` |  |  |
| `npm run check` |  |  |
| `npm run smoke:critical-path` |  |  |
| `npm run smoke:operational` |  |  |
| `npm run smoke:demo:e2e` |  |  |
| `npm run deploy:prod:dry-run` |  |  |
| `npm run smoke:p95 -- https://<arbor-os-url> --threshold 500 --samples 5` |  |  |
| `npm run smoke:web:tti -- https://<arbor-web-url> --threshold 3000` |  |  |
| `npm run verify:mobile` |  |  |
| `npm run smoke:mobile -w arbor-mobile` |  |  |

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
|  |  |  |  |  |  |

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

- Decyzja: `GO` / `NO-GO`
- Uzasadnienie:
- Wlasciciel pilota:
- Data i godzina podpisu:
- Nastepny krok:
