# Polska Flora / ARBOR — aktualny stan i plan dalszych prac

**Data audytu:** 2026-07-29  
**Cel dokumentu:** jedna aktualna odpowiedź na pytania: co istnieje, co jest gotowe, co trzeba potwierdzić oraz co należy jeszcze dorobić.

## 1. Podsumowanie

Projekt nie jest prototypem od zera. To rozbudowane monorepo obejmujące:

- panel webowy dla biura, kierownika i dyrekcji;
- aplikację mobilną Expo / React Native dla pracy terenowej;
- główny backend Express + PostgreSQL w `os`;
- integracje Kommo, Zadarma/Twilio, e-mail, storage plików i monitoring;
- moduły planowania, ekip, floty, magazynu, HR, CRM, wycen, zleceń, rozliczeń i BI;
- skrypty wdrożeniowe, migracje, smoke testy, testy kontraktowe i runbooki operacyjne;
- dodatkową aplikację `platform`, która nie jest obecnie głównym produkcyjnym frontendem.

Największym zadaniem nie jest dziś dopisanie całego systemu, tylko:

1. ustalenie jednej architektury produkcyjnej i usunięcie ścieżek równoległych;
2. przeprowadzenie prawdziwego UAT od leada do rozliczenia;
3. domknięcie wydania mobilnego, monitoringu, backupu i konfiguracji integracji;
4. naprawa oraz skrócenie bramki CI;
5. pilotaż jednego oddziału i poprawki wynikające z realnej pracy;
6. dopiero później optymalizacja, skalowanie i rozwój funkcji premium.

## 2. Architektura i źródła prawdy

| Obszar | Technologia / katalog | Docelowa rola |
|---|---|---|
| Web | React + Vite, `web/` | główny panel produkcyjny |
| Mobile | Expo + React Native, `mobile/` | aplikacja terenowa |
| Backend | Express + PostgreSQL, `os/` | jedyne produkcyjne źródło prawdy API i danych |
| Lokalne/demo API | `web/server/` | tylko development/demo; nie rozwijać jako drugiego backendu |
| Platforma alternatywna | `platform/` | podjąć decyzję: archiwizacja, sandbox lub osobny produkt |
| Deploy | Render/Vercel/Netlify + skrypty `deploy/`, `scripts/` | wybrać i opisać jedną zalecaną ścieżkę produkcyjną |

### Decyzje architektoniczne do podjęcia

- Potwierdzić, że `os` jest jedynym backendem produkcyjnym.
- Potwierdzić, że `web` jest jedynym panelem operacyjnym.
- Określić status `platform`: rozwijany produkt, demo czy kod do archiwizacji.
- Wycofać nieużywane warianty deployu po potwierdzeniu docelowego hostingu.
- Ustalić politykę dla starych prototypów, logów, wyników i katalogów tymczasowych.

## 3. Stan funkcjonalny modułów

Legenda:

- **Jest** — moduł ma kod, API i sensowną ścieżkę użytkownika.
- **UAT** — rdzeń istnieje, ale gotowość wymaga testu na realnym środowisku i danych.
- **Dorobić** — jawny brak lub praca potrzebna przed produkcją.

| Moduł | Stan | Co istnieje | Co pozostaje |
|---|---|---|---|
| Logowanie, role, oddziały | UAT | JWT, role, scope oddziału i ekipy, route guards, audyt RBAC | test macierzy ról na realnych kontach; przegląd uprawnień finansowych i eksportów |
| CRM i Kommo | UAT | leady, pipeline, inbox, inbound/outbound sync, mapowanie pól, retry, dead-letter, idempotencja i diagnostyka | podłączyć konto produkcyjne; zatwierdzić mapowanie statusów/pól; wykonać drill awarii i konfliktów |
| Telefonia i SMS | UAT | Zadarma/Twilio, historia, statusy dostarczenia, szablony, webhooki, działania operacyjne | zweryfikować podpisy webhooków i numery produkcyjne; test dostarczenia; zgody, retencja nagrań i procedura fallback |
| Oględziny i wyceny | UAT | plan oględzin, formularze terenowe, zdjęcia, akceptacje, PDF i przejście do zlecenia | UAT pełnego przebiegu; limity/upload dużych zdjęć; spójność PDF i danych klienta |
| Zlecenia | UAT | statusy, wymagane dane, planowanie, dokumenty, zdjęcia, work logi, finish i rozliczenie | potwierdzić finalną maszynę statusów i blokady; przetestować edycję równoległą i błędy sieci |
| Dispatcher i harmonogram | UAT | auto-plan, ograniczenia, diagnostyka nieprzypisanych, kalendarz tygodniowy, DnD, mapa i zapis planu dnia | benchmark 50 zleceń × 10 ekip; UAT ręcznych korekt; decyzja o docelowym solverze i kosztach API map |
| Aplikacja mobilna | UAT / Dorobić | dzisiejsze zlecenia, START/STOP, GPS, PROBLEM, zdjęcia, materiały, koszty, rezerwacje i kolejka offline | monitoring produkcyjny; buildy sklepowe; test na fizycznych Android/iOS; konfliktowe przypadki offline; polityka minimalnej wersji |
| Flota i sprzęt | UAT | pojazdy, maszyny, naprawy, części, przeglądy, rezerwacje i blokady | wprowadzić realne dane; sprawdzić alerty terminów, odpowiedzialność i proces przyjęcia/zwrotu |
| Magazyn | UAT | stany, przyjęcia, rozchód na zlecenie i integracja z finish | inwentaryzacja startowa; jednostki i korekty; uprawnienia; procedura braków i anulowania rozchodu |
| HR, kompetencje, czas pracy | UAT | ECP z work logów, kompetencje, ważność uprawnień i blokady przypisania | decyzja ostrzeżenie vs twarda blokada; realne kompetencje; akceptacja korekt czasu i eksportów |
| Rozliczenia i BI | UAT | wspólny silnik marży, koszty pracy/sprzętu/paliwa/materiałów, alerty i drill-down | walidacja z księgowością na próbce zleceń; zamknięcie miesiąca; definicje KPI i źródeł kosztów |
| Link klienta | UAT | bezpieczny token, status, mapa, historia i propozycje okien | test prywatności i wygasania tokenów; treści prawne; test na produkcyjnej domenie |
| Observability i bezpieczeństwo | Dorobić | health/ready/metrics, Sentry web/backend, rate limiting, audyt, threat model i runbooki | Sentry lub zatwierdzony zamiennik dla mobile; test alertów; przegląd sekretów, webhooków, uploadów i retencji |
| Backup i odtwarzanie | UAT | skrypty backup/restore i runbook RPO/RTO | wykonać oraz udokumentować prawdziwy restore drill z produkcyjnego typu bazy |
| Test/demo mode | Jest | dane demonstracyjne, role i smoke tras | wyraźnie odseparować od produkcji; okresowo synchronizować kontrakty z realnym API |

## 4. Aktualnie potwierdzony stan techniczny

Na dzień audytu:

- publiczny web działa pod `https://arbo-web.onrender.com`;
- domena `https://arbo-os.com` działa;
- API działa pod `https://arbor-os-b7k6.onrender.com/api`;
- produkcyjny smoke rozpoznaje wdrożony build `2050959`;
- kontrakt Polska Flora i konfiguracja wspólnego deployu przechodzą;
- raport `npm run status:production` ma status **blocked** z powodu braku produkcyjnego monitoringu aplikacji mobilnej;
- `RENDER_WEB_DEPLOY_HOOK_URL` nie jest ustawiony, więc redeploy web wymaga ręcznego uruchomienia;
- pełne `npm run check` uruchomione jako jedna sekwencja przekroczyło limit 5 minut, ale audyt składowych 2026-07-29 potwierdził, że bramka nie wisi: testy web trwają około 154 s, mobile około 73 s, a wszystkie składowe przeszły osobno;
- drzewo robocze zawiera lokalne, niezacommitowane zmiany, dlatego przed porządkami i scalaniem trzeba je najpierw przejrzeć i przypisać do konkretnych prac.

### Wynik rozpoczęcia Etapu 0 — 2026-07-29

| Bramka | Wynik |
|---|---|
| `npm run verify:scripts` | **PASS** — 201 testów, CircleCI i GitHub Actions OK |
| `npm run verify:mobile` | **PASS** — TypeScript i lint OK |
| `npm run verify:web:test` | **PASS** — 46 plików, 217 testów |
| `npm run verify:web` | **PASS** — build produkcyjny Vite OK |
| `npm run verify:os` | **PASS** — ESLint OK |
| testy uploadów i bezpieczeństwa webhooków | **PASS** — 3 zestawy, 13 testów |

Wniosek: podstawowa bramka statyczna jest zielona. Do poprawy pozostaje czas i sposób raportowania pełnej komendy oraz ostrzeżenia buildu: brak uploadu source map do Sentry i duże chunki JS/CSS.

Raport mobile potwierdza gotowy build preview Androida i blokady produkcyjne:

- Android preview: build jest gotowy do QA na urządzeniu;
- iOS preview: wymaga interaktywnej konfiguracji poświadczeń Apple/EAS;
- monitoring produkcyjny: brak Sentry DSN lub zatwierdzonego zamiennika;
- publikacja sklepowa: 6 ręcznych bramek, przegląd prawny i device smoke bez dowodów właściciela.

## 5. Backlog priorytetowy

### P0 — przed kolejnym wydaniem produkcyjnym

- [ ] Dodać `EXPO_PUBLIC_SENTRY_DSN` albo formalnie zatwierdzić inne monitorowanie błędów mobile.
- [ ] Uruchomić `npm run release:status -w arbor-mobile` i zamknąć wszystkie blokady.
- [x] Zdiagnozować czas/zawieszenie `npm run check` — składowe przechodzą, problemem jest czas sekwencyjnego wykonania, nie zawieszenie.
- [ ] Ustawić limit czasu i czytelny raport per etap CI oraz używać istniejącej bramki równoległej tam, gdzie jest stabilna.
- [ ] Przejrzeć niezacommitowane zmiany, podzielić je na logiczne commity i nie mieszać ich z porządkami repo.
- [x] Uruchomić automatyczne testy bezpieczeństwa webhooków telefonii i walidacji uploadów — 13/13 testów przechodzi.
- [ ] Wykonać manualny test bezpieczeństwa webhooków i uploadów na środowisku stagingowym.
- [ ] Wykonać migracje na kopii środowiska produkcyjnego.
- [ ] Wykonać backup i pełny restore drill.
- [ ] Przeprowadzić krytyczny smoke: Kommo/manual intake → oględziny → wycena → plan → mobile START/STOP → finish → marża → sync Kommo.
- [ ] Potwierdzić storage S3 dla zdjęć i dokumentów; lokalny dysk hostingu nie może być jedynym storage.
- [ ] Ustawić `RENDER_WEB_DEPLOY_HOOK_URL` lub opisać zatwierdzony ręczny proces redeployu.

### P1 — gotowość pilota jednego oddziału

- [ ] Utworzyć konta: admin, dyrektor, kierownik, wyceniający, brygadzista.
- [ ] Wprowadzić oddział, ekipy, pojazdy, maszyny, magazyn i kompetencje.
- [ ] Skonfigurować Kommo, Zadarma/SMS, domeny, e-mail i szablony.
- [ ] Przetestować macierz ról i widoczność danych między oddziałami.
- [ ] Przejść scenariusz A–Z na minimum 5 realnych lub realistycznych zleceniach.
- [ ] Przetestować offline na fizycznym telefonie: START, zdjęcie, PROBLEM, finish i ponowna synchronizacja.
- [ ] Zweryfikować marżę z księgowością na minimum 10 zamkniętych zleceniach.
- [ ] Przeszkolić kierownika i brygadzistów; przygotować krótkie instrukcje ekranowe.
- [ ] Wyznaczyć właścicieli alertów: API, storage, Kommo, SMS, backup i mobile.
- [ ] Zebrać problemy pilota w jednym backlogu z właścicielem, priorytetem i terminem.

### P2 — po stabilnym pilocie

- [ ] Benchmark i strojenie dispatchera dla 50 zleceń × 10 ekip.
- [ ] Testy obciążeniowe API, bazy, uploadów i SSE.
- [ ] Automatyzacja deployu z zatwierdzeniami, rollbackiem i smoke po wdrożeniu.
- [ ] Rozszerzenie raportów dyrektorskich po zatwierdzeniu definicji KPI.
- [ ] Usprawnienie korekt magazynowych, ECP i miesięcznego zamknięcia.
- [ ] Pełne testy dostępności i responsywności kluczowych ekranów.
- [ ] Uporządkowanie duplikatów UI, tokenów design systemu i dużych komponentów.
- [ ] Retencja i archiwizacja zdjęć, dokumentów, nagrań i logów zgodnie z polityką firmy.

### P3 — rozwój produktu

- [ ] Zaawansowany solver VRP, jeśli benchmark obecnego rozwiązania nie spełni wymagań.
- [ ] Rozbudowane prognozowanie obłożenia, marży i zapotrzebowania.
- [ ] Samoobsługowy portal klienta szerszy niż publiczny link statusowy.
- [ ] Wielooddziałowe automatyzacje i centralne zarządzanie konfiguracją.
- [ ] Dalsze automatyzacje AI dopiero po ustabilizowaniu danych i procesów bazowych.

## 6. Plan realizacji

### Etap 0 — porządek i zielona bramka, 1–2 tygodnie

**Cel:** powtarzalny build, test i deploy.

Zakres:

- monitoring mobile;
- diagnostyka `npm run check`;
- przegląd zmian lokalnych;
- testy bezpieczeństwa uploadów i webhooków;
- potwierdzenie źródeł prawdy i statusu `platform`;
- backup/restore drill;
- ujednolicenie dokumentacji startowej.

**Definition of Done:** lokalna i CI bramka kończy się jednoznacznym wynikiem, raport produkcyjny nie ma blokad, a zespół potrafi odtworzyć bazę.

### Etap 1 — UAT i konfiguracja oddziału, 2 tygodnie

**Cel:** przygotowany oddział, użytkownicy i integracje.

Zakres:

- dane startowe;
- role i scope;
- Kommo, telefonia, SMS, storage;
- testy web/mobile na realnych urządzeniach;
- próbne scenariusze biznesowe.

**Definition of Done:** wszystkie krytyczne role przechodzą swoje scenariusze bez dostępu do niedozwolonych danych.

### Etap 2 — pilot operacyjny, 2–4 tygodnie

**Cel:** jeden oddział pracuje w systemie jako głównym narzędziu.

Zakres:

- codzienny intake i CRM;
- oględziny, wyceny i planowanie;
- realizacja mobilna online/offline;
- magazyn, flota, czas pracy;
- rozliczenie, marża i raport kierownika;
- codzienny triage problemów.

**Definition of Done:** minimum 2 pełne tygodnie pracy bez utraty danych i bez powrotu do arkusza jako źródła prawdy.

### Etap 3 — stabilizacja i rollout, 2–4 tygodnie

**Cel:** usunięcie problemów pilota i przygotowanie kolejnych oddziałów.

Zakres:

- poprawki P0/P1;
- wydajność i alerty;
- instrukcje oraz szkolenia;
- szablon danych startowych oddziału;
- plan migracji i wsparcia.

**Definition of Done:** powtarzalny onboarding następnego oddziału, jasne SLA i właściciele systemu.

### Etap 4 — optymalizacja i rozwój, iteracyjnie

**Cel:** zwiększać automatyzację dopiero na wiarygodnych danych.

Zakres:

- strojenie dispatchera;
- BI i prognozy;
- automatyzacje wielooddziałowe;
- portal klienta;
- optymalizacja kosztów infrastruktury.

## 7. Scenariusze odbiorowe A–Z

Każde wydanie pilotażowe powinno potwierdzić:

1. Lead wpływa z Kommo albo jest dodany ręcznie.
2. Telefon/SMS i historia kontaktu są zapisane.
3. Powstają oględziny z terminem, osobą i adresem.
4. Wyceniający dodaje zakres, ryzyka, zdjęcia i wycenę.
5. Wymagana akceptacja zostaje wykonana.
6. Powstaje zlecenie z oknem klienta, sprzętem i kompetencjami.
7. Dispatcher proponuje plan albo czytelnie wyjaśnia brak przypisania.
8. Kierownik koryguje plan bez utworzenia konfliktu.
9. Brygadzista widzi zlecenie i wykonuje START z GPS.
10. Zdjęcia, PROBLEM i materiały działają online oraz offline.
11. STOP/finish zapisuje czas, płatność i wszystkie koszty.
12. Magazyn, ECP i rezerwacje sprzętu są zaktualizowane.
13. Marża jest zgodna z ręcznym wyliczeniem kontrolnym.
14. Kierownik widzi ryzyka, a dyrektor wynik i drill-down.
15. Kommo otrzymuje finalny status i pakiet operacyjny.
16. Klient widzi wyłącznie bezpieczne dane w linku statusowym.
17. Powtórzenie requestów nie tworzy duplikatów.
18. Awaria integracji trafia do retry/dead-letter i ma właściciela.

## 8. Definition of Done dla każdego zadania

Zadanie jest skończone dopiero, gdy:

- ma opis celu i kryteria akceptacji;
- działa dla właściwych ról i zakresów oddziału;
- ma walidację wejścia oraz czytelne błędy;
- ma test jednostkowy/integracyjny adekwatny do ryzyka;
- przechodzi właściwy smoke;
- nie psuje ścieżki online ani offline, jeśli dotyczy mobile;
- zapisuje audyt i telemetrykę dla operacji krytycznych;
- ma migrację i rollback, jeśli zmienia bazę;
- ma zaktualizowaną dokumentację użytkową lub runbook;
- zostało sprawdzone na środowisku zbliżonym do produkcji.

## 9. Organizacja backlogu

Każde zadanie powinno zawierać:

- **priorytet:** P0–P3;
- **moduł:** web, mobile, backend, integracja, infrastruktura;
- **właściciela biznesowego i technicznego**;
- **kryteria akceptacji**;
- **zależności**;
- **estymatę**;
- **środowisko testowe**;
- **wynik testu i link do dowodu**;
- **plan rollbacku**, jeśli zmiana dotyczy produkcji.

Nie należy traktować samego istnienia pliku kontraktowego lub skryptu `verify:*` jako dowodu gotowości biznesowej. Dowodem jest przejście automatycznej bramki oraz UAT na realnym scenariuszu.

## 10. Najbliższa kolejność działań

1. Domknąć niezacommitowane prace i bezpieczeństwo uploadów/webhooków.
2. Naprawić pełną bramkę `npm run check`.
3. Skonfigurować monitoring mobile i uzyskać zielony raport produkcyjny.
4. Wykonać backup/restore drill.
5. Skonfigurować oddział pilotażowy i integracje.
6. Przejść scenariusz A–Z na fizycznym telefonie.
7. Uruchomić 2-tygodniowy pilot.
8. Naprawić P0/P1 z pilota.
9. Dopiero potem skalować na następne oddziały i rozwijać funkcje P2/P3.

## 11. Powiązane dokumenty

- `docs/ARBOR-full-scope-implementation-backlog.md` — historyczny, bardzo szczegółowy backlog implementacyjny;
- `docs/PILOT-ONE-BRANCH-CHECKLIST.md` — techniczna checklista pilota;
- `docs/PRODUCTION-READINESS-CHECKLIST.md` — bramka produkcyjna;
- `docs/ENVIRONMENT-RUNBOOK.md` — konfiguracja środowisk;
- `docs/RBAC-BRANCH-SCOPE-AUDIT.md` — role i zakres danych;
- `docs/MOBILE-OFFLINE-CONTRACT.md` — kontrakt pracy offline;
- `docs/BACKUP-RPO-RTO-RUNBOOK.md` — backup i odtwarzanie;
- `docs/OBSERVABILITY-SLO-RUNBOOK.md` — monitoring i SLO;
- `docs/PRODUCTION-INCIDENT-RUNBOOK.md` — obsługa incydentów.
