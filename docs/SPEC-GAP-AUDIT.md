# ARBOR-OS: audyt specyfikacji vs repo

Data audytu: 2026-05-07  
Źródło specyfikacji: `C:\Users\paha1\OneDrive\Desktop\Specyfikacja_Systemu_ARBOR-OS.rtf`  
Zakres audytu: statyczne porównanie specyfikacji z aktualnym kodem w `os`, `web`, `mobile` oraz istniejącymi dokumentami w `docs`.

## Szybki werdykt

Repo ma już solidny szkielet produktu: backend Express/PostgreSQL, web React, mobile Expo/React Native, autoryzację, oddziały, ekipy, zlecenia, wyceny, raporty, flotę, SMS, Kommo w częściowej formie, zdjęcia, work logi, offline queue oraz sporo ekranów web/mobile.

Nie jest to jeszcze pełny system ze specyfikacji. Największe braki produktowe są w pięciu miejscach:

1. Pełny AI Dispatcher/VRP z oknami czasowymi, kompetencjami, sprzętem i benchmarkiem 50 zleceń x 10 ekip.
2. Pełna dwukierunkowa integracja Kommo z retry, dead-letter, konfliktem zmian, zdjęciami, kosztorysem i marżą.
3. Silnik rentowności zlecenia: koszty pracy, sprzętu, paliwa, materiałów, utylizacji i marża per zlecenie.
4. Offline-first v2 w mobile: cache dzisiejszych zleceń, konflikty po synchronizacji, spójne idempotency-key na wszystkich krytycznych zapisach.
5. Produkcyjne NFR: backup RPO/RTO, testy p95 API, storage/retencja zdjęć, skalowanie i obserwowalność.

## Legenda statusów

| Status | Znaczenie |
|---|---|
| Jest | Rdzeń funkcji istnieje i ma sensowny kod/API/UI. |
| Częściowo | Istnieje MVP, fragment flow albo lokalna implementacja, ale spec wymaga więcej. |
| Brak | Nie widać kompletnej implementacji w repo. |
| Do decyzji | Potrzebna decyzja produktowa/architektoniczna zanim warto kodować. |

## Mapa specyfikacji

| Obszar ze specyfikacji | Status | Co już jest w repo | Brak do pełnej zgodności |
|---|---|---|---|
| Architektura web/mobile/backend/PostgreSQL | Jest | `web` React, `mobile` Expo RN, `os` Express, `os/migrate.sql`, env example w `os`, `web`, `mobile`. | Jedna nadrzędna dokumentacja środowiskowa i decyzja, które API jest produkcyjnym źródłem prawdy: `os` vs lokalny `web/server`. |
| Role i oddziały | Częściowo | JWT, `authMiddleware`, `buildAppPermissions`, oddziały, ekipy, role, filtry `oddzial_id` w wielu trasach. | Audyt spójności RBAC w każdej ścieżce zapisu, ukrywanie akcji w UI, test macierzy Dyrektor/Kierownik/Brygadzista/Wyceniający. |
| Kommo CRM | Częściowo | `os/src/services/kommo.js`, `os/src/routes/kommoQuotationWebhook.js`, `tasks/:id/kommo-payload`, `tasks/:id/kommo-push`, pola `kommo_last_sync_*`, dokumenty w `web/docs/kommo-*`. | Pełne mapowanie statusu "Do realizacji", załączniki, zdjęcia, realny czas, zużycie, kosztorys z marżą, replay, dead-letter, strategia konfliktów Kommo <-> ARBOR. |
| Mapy, GPS, geokodowanie | Częściowo | GPS start/stop, GPS zdjęć, live locations ekip, `geocodeNominatim`, sloty wycen z ETA, linki map w mobile. | Decyzja Google/Mapbox, Distance Matrix/Routes API, pełny widok mapy planistycznej i koszt API. |
| AI Dispatcher / VRP | Częściowo / Brak | `AutoplanDnia`, `autoplanShared`, heurystyki planu i lokalna historia, sloty wycen. | Solver `POST /api/dispatch/plan`, okna czasowe, czas obsługi, priorytety, kompetencje, sprzęt, benchmark, obsługa braku rozwiązania. |
| Mobilka brygadzisty | Częściowo | `mobile/app/zlecenie/[id].tsx`, START/STOP, GPS, problem, zdjęcia, kolejka offline, zakładki logi/problemy/zdjęcia, raport dzienny. Backend: `work_logs`, `photos`, `issues`, idempotency dla wybranych akcji. | Pełny cache dzisiejszych zleceń offline, testy airplane mode, rozwiązywanie konfliktów, reguła zdjęć Przed/Po konfigurowalna per oddział, komplet raportu zużycia jako jeden flow. |
| Panel Kierownika | Częściowo | `Harmonogram`, `Kierownik`, `Ekipy`, `Flota`, `RezerwacjeSprzetu`, `Ogledziny`, live GPS w oględzinach/wycenach. | Jeden tygodniowy kalendarz zasobów, drag and drop z walidacją kolizji, mapa planistyczna, integracja z wynikiem dispatchera. |
| Panel Dyrektorski / BI | Częściowo | `Dashboard`, `Raporty`, `RaportyMobilne`, `KpiTydzien`, `CrmDashboard`, `PayrollM11`, endpointy raportowe. | Dashboard 6 oddziałów z plan vs real, marża z prawdziwych kosztów, alerty rentowności/przeglądów/kompetencji, drill-down BI do zlecenia. |
| Komunikacja z klientem | Częściowo | SMS, historia SMS, webhook statusu, publiczna akceptacja wyceny `quotation-public`, telefony/Twilio, linki ofert. | Link statusowy zlecenia dla klienta z mapą i historią statusów, pełne szablony SMS per status, obsługa okien czasowych klienta w całym cyklu. |
| Zasoby, sprzęt, magazyn | Częściowo | `vehicles`, `equipment_items`, `repairs`, `equipment_reservations`, `Flota`, `MagazynWeb`, `rezerwacje-sprzetu`. | Magazyn zespołowy na backendzie, stany/przyjęcia/rozchód na zlecenie, motogodziny, przeglądy i blokada użycia po terminie. |
| HR, kompetencje, ECP | Częściowo | `users`, `role`, `user_competencies`, `godziny`, payroll/team-day reports, stawki i rozliczenia. | Automatyczna ECP z work logów, monitoring ważności uprawnień, twarda blokada przypisania bez kompetencji we wszystkich ścieżkach. |
| Rentowność zlecenia | Częściowo | `task_rozliczenie`, `task_finish_material_usage`, `task_client_payments`, payroll, kalkulacje wycen i progi marży w wycenach. | Jeden silnik kosztów i marży dla zlecenia wykonawczego: robocizna, sprzęt, paliwo, materiały, utylizacja, amortyzacja. |
| Wymagania niefunkcjonalne | Częściowo | Health/status scripts, `/api/ready`, `/api/metrics`, testy backendu/web, lint/build. | Test p95 API, TTI web, backupy RPO/RTO, skalowanie workerów/uploadów/sesji, polityka retencji zdjęć i dokumentów. |

## Priorytety dalszej pracy

### P0: Stabilny pilotaż 1 oddziału

Cel: jeden oddział działa bez Excela na codziennych zleceniach.

1. Uporządkować `env` i uruchamianie: jeden dokument `.env.example`/README dla `os`, `web`, `mobile`, Kommo, SMS, map.
2. Dokończyć RBAC matrix: kto może tworzyć, przypisywać, startować, stopować, zamykać, edytować finanse i wysyłać Kommo.
3. Utwardzić ścieżkę zlecenia: utworzenie -> przypisanie -> START z GPS -> zdjęcia -> PROBLEM -> STOP -> raport -> rozliczenie.
4. Spisać i przetestować offline contract: które operacje idą do kolejki, które wymagają sieci, jak działa retry i idempotency-key.
5. Zrobić minimalny Kommo MVP: jeden status wejściowy, jeden payload wyjściowy, log sync, ręczny replay.

### P1: Dane pod dispatcher i marżę

Cel: nie budować AI na pustym modelu danych.

1. Dodać pola planistyczne do zleceń: okno czasowe, czas obsługi, priorytet, wymagany sprzęt, wymagane kompetencje.
2. Dodać model kosztowy: stawki pracy, stawki sprzętu, paliwo, materiały, utylizacja, koszt stały/zmienny.
3. Przygotować ADR: Google Routes/Mapbox/OR-Tools, koszt miesięczny, limity, dane wejściowe i wynik planu.

### P2: Dispatcher v1

Cel: pierwsza wersja "ułóż dzień" dla Kierownika.

1. `POST /api/dispatch/plan` dla jednego oddziału i jednego dnia.
2. Wynik: kolejność zleceń, przypisanie ekip, ETA, ostrzeżenia o konfliktach.
3. UI: podgląd planu, ręczna korekta, zapis planu.
4. Benchmark: najpierw 20 x 5, potem 50 x 10.

### P3: BI i dyrektorska kontrola marży

Cel: zlecenie po zamknięciu ma policzony wynik.

1. Kalkulator rentowności zlecenia jako serwis backendowy.
2. Dashboard oddziałów: obrót, koszt, marża, odchylenie plan/real.
3. Alerty: marża poniżej progu, brak zdjęć, opóźnione zlecenie, sprzęt po terminie przeglądu.

## Proponowany następny pakiet roboczy

Najrozsądniejszy kolejny pakiet to P0.3 + P0.4, czyli "terenowy obieg zlecenia do pilotażu":

| Zadanie | Kryterium ukończenia |
|---|---|
| Test ścieżki START/STOP/zdjęcia/problem na backendzie | Testy backendu pokrywają happy path i brak GPS/zdjęć. |
| Test mobile offline queue dla zlecenia | Checklist: start offline, zdjęcie offline, problem offline, sync po powrocie sieci. |
| Raport zużycia jako część zamknięcia | Backend zapisuje paliwo/materiały/odpady, UI pokazuje wynik. |
| Idempotency-key na krytycznych zapisach | Powtórzone żądanie nie tworzy duplikatu work loga/problemu/zdjęcia. |
| Dokument QA pilotażu | Jeden plik z ręcznym scenariuszem dla Brygadzisty i Kierownika. |

## Kryteria jakości przed każdym kolejnym krokiem

Przed dopisywaniem dużych funkcji warto utrzymać te bramki:

```powershell
npm run status:json:strict
npm run check
npm test -w arbor-os
npx expo export --platform web --output-dir "$env:TEMP\arbor-mobile-export-check"
```

Manual smoke dla pilotażu:

1. Dyrektor/Kierownik loguje się i widzi tylko właściwy oddział lub wszystkie oddziały.
2. Kierownik tworzy zlecenie, przypisuje ekipę i sprzęt.
3. Brygadzista widzi zlecenie w mobile, robi START z GPS.
4. Brygadzista dodaje zdjęcia Przed, zgłasza problem, dodaje zdjęcia Po.
5. Brygadzista kończy zlecenie i podaje zużycie.
6. Kierownik widzi raport, log pracy, problem, zdjęcia i status.
7. Dyrektor widzi efekt w raporcie oddziału.
8. Kommo dostaje ręczny push albo zapisuje czytelny błąd sync.

## Powiązane pliki

| Temat | Pliki |
|---|---|
| Pełny backlog | `docs/ARBOR-full-scope-implementation-backlog.md` |
| Poprzednia roadmapa/gap | `docs/ARBOR-executive-summary-gap-roadmap-rfp.md` |
| Parzystość mobile/web | `docs/MOBILE-WEB-PARITY.md` |
| Backend API | `os/src/routes/*`, `os/docs/openapi.yaml` |
| Schemat bazy | `os/migrate.sql` |
| Mobile field flow | `mobile/app/zlecenie/[id].tsx`, `mobile/utils/offline-queue.ts` |
| Web operacyjny | `web/src/pages/Harmonogram.js`, `web/src/pages/Zlecenia.js`, `web/src/pages/ZlecenieDetail.js` |
| Kommo | `os/src/services/kommo.js`, `os/src/routes/kommoQuotationWebhook.js`, `web/docs/kommo-*.md` |

## Decyzje, których nie warto odkładać

1. Czy produkcyjnym backendem jest wyłącznie `os`, a `web/server` zostaje tylko lokalnym/mock full-stackiem?
2. Czy dispatcher ma używać Google Routes, Mapbox Optimization, czy OR-Tools/self-hosted?
3. Jaki jest minimalny model marży dla pierwszego pilotażu: tylko roboczogodziny, czy od razu paliwo/sprzęt/materiały?
4. Które operacje mobile muszą działać offline w 100 procentach, a które mogą wymagać sieci?
5. Czy Kommo jest masterem danych klienta i leada, czy po statusie "Do realizacji" ARBOR staje się masterem operacyjnym?

