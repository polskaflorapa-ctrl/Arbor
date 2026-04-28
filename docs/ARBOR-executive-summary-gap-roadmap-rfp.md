# ARBOR-OS — Executive Summary → stan kodu, roadmapa, RFP

Dokument łączy **Executive Summary** (wersja robocza) z **faktycznym stanem repozytorium**, **propozycją etapów 8 miesięcy** oraz **szablonem odpowiedzi na pytania do wykonawcy (§9)** — do użytku wewnętrznego i w ofercie.

**Pełna lista prac pod „cały funkcjonal” (epiki → checkboxy):** zobacz [`ARBOR-full-scope-implementation-backlog.md`](./ARBOR-full-scope-implementation-backlog.md).

---

## A. Mapowanie: 7 modułów vs kod (gap analysis)

Legenda: **Tak** = jest sensowny rdzeń w repo · **Częściowo** = szkielet / MVP / jedna ścieżka · **Nie** = brak lub tylko dokumentacja.

| # | Moduł (Executive Summary) | Stan w repozytorium | Wskazówki ścieżek / uwagi |
|---|----------------------------|---------------------|---------------------------|
| 1 | **AI Dispatcher (VRP, okna czasowe, kompetencje, sprzęt, auto-dispatch)** | **Częściowo** | Sloty / ETA / GPS ekipy przy wycenach: `os/src/routes/wyceny.js`, logika „dispatch” w UI: `web/src/pages/Ogledziny.js`. Dokumentacja operacyjna: `web/docs/dispatch-pro-*.md`. **Brak** pełnego silnika VRP (OR-Tools / Google Routes API jako batch solver), brak globalnego „jednym kliknięciem” dla 50×10. |
| 2 | **Mobilka brygadzisty (START/STOP, PROBLEM, zdjęcia Przed/Po, zużycie, offline)** | **Częściowo** | API: `work_logs` START/STOP + GPS w `os/src/routes/tasks.js`. Mobilka Expo: `mobile/` (ekrany w `mobile/app/`). **Offline:** kolejka HTTP w `mobile/utils/offline-queue.ts`, synchronizacja `mobile/components/offline-queue-sync.tsx` — to jest **fragment offline-first** (kolejka żądań), nie pełna replika lokalnej bazy zleceń + rozwiązywanie konfliktów. |
| 3 | **Panel Kierownika (kalendarz drag&drop, mapa, karty sprzętu, alerty)** | **Częściowo** | `web/src/pages/Harmonogram.js`, `Kierownik.js`, `Flota.js`, `Ekipy.js` — kalendarze i operacje; **drag&drop planowania tras na mapie** i „jedna mapa prawdy” dla wszystkich zasobów — do doprecyzowania w kodzie vs spec. |
| 4 | **Panel Dyrektorski / BI (6 oddziałów, marża, plan vs real, alerty)** | **Częściowo** | `web/src/pages/Raporty.js`, `Dashboard.js`, `Ksiegowosc.js`, CRM overview: `os/src/routes/crm.js`, `web/src/pages/CrmDashboard.js`. **Silnik marży** (koszt zmienny per zlecenie, alokacja paliwa/serwisu) — wymaga osobnego modelu danych i raportów, nie jest domknięty w jednym module. |
| 5 | **Komunikacja z klientem (SMS, okna czasowe, link statusowy)** | **Częściowo** | SMS / telefon: `os/src/routes/sms.js`, `telefon.js`, integracje w `web/src/pages/Telefonia.js`, `Integracje.js`. **Link statusowy** — tokeny / publiczne endpointy wymagają audytu spójności między `os` a `web`. Pełny „cykl życia SMS” jak w spec — do domknięcia procesowo. |
| 6 | **Zarządzanie zasobami (maszyny, przeglądy, magazyn)** | **Częściowo** | Flota / pojazdy / naprawy: `os/migrate.sql` (vehicles, repairs…), `web/src/pages/Flota.js`. **Magazyn materiałów eksploatacyjnych** jako osobny moduł gospodarki magazynowej — **Nie** w pełnym zakresie specyfikacji. |
| 7 | **HR / kadry (ECP, kompetencje, blokada przypisań)** | **Częściowo / Nie** | Godziny / rozliczenia: `os/src/routes/godziny.js`, `rozliczenia.js`, kompetencje w migracji (`user_competencies`). **Automatyczna ECP + twarde blokady przypisań bez uprawnień** — wymaga produktowej reguły i spójnego UI we wszystkich ścieżkach przypisania. |

### Integracja Kommo (dwukierunkowo)

| Kierunek | Stan | W repozytorium |
|----------|------|----------------|
| Kommo → ARBOR | **Częściowo** | Serwis `os/src/services/kommo.js`, webhooki / scenariusze w `web/docs/kommo-*.md`. |
| ARBOR → Kommo | **Częściowo** | Push zlecenia: `os/src/routes/tasks.js` (`kommo-payload`, `kommo-push`), pola sync w DB. Pełna dwukierunkowość (zdjęcia, kosztorys, marża) — **do rozplanowania** jako backlog epików. |

### Stos vs rekomendacja z Executive Summary

| Warstwa | Spec | Repo |
|---------|------|------|
| Web | React / Vue | **React** — `web/` |
| Mobile | RN / Flutter | **Expo / React Native** — `mobile/` |
| Backend | Nest / FastAPI | **Express (Node)** — `os/`, dodatkowo lokalne API demo `web/server/` |
| Baza | PostgreSQL | **PostgreSQL** — `os/migrate.sql`, pool w `os/src/config/database.js` |
| Mapy / routing | Google / Mapbox | **Częściowo** — geolokalizacja / pinezki / ETA w produktach; **brak** zamówionego silnika VRP jak w §3 pkt 1 |

---

## B. Roadmapa 8 miesięcy (dopasowana do repo — propozycja)

Założenie: **1 zespół produktowo‑techniczny**, priorytet **stabilizacja `os` + `web` + `mobile`** jako jednej platformy dla 6 oddziałów (najpierw 1 oddział pilotażowy).

### Etap 1 — Fundamenty (mies. 1–2) — *największy overlap z kodem*

**Cel:** pilotaż w 1 oddziale — dane, RBAC, mobilka dzienna, Kommo „minimum viable”.

| Tydzień | Dostarczenie | Powiązanie z kodem |
|---------|--------------|-------------------|
| 1–2 | Ujednolicenie auth, ról (Dyrektor / Kierownik / Brygadzista), audyt krytycznych ścieżek | `os/src/middleware/auth.js`, role w `web/src/`, `mobile/` |
| 2–3 | Zamknięcie ścieżki: zlecenie → ekipa → work log → raport | `os/src/routes/tasks.js`, `work_logs` |
| 3–4 | Mobilka: START/STOP, PROBLEM, zdjęcia — spójność z API + **rozszerzenie offline** (które operacje w kolejce, retry, idempotencja) | `mobile/`, `offline-queue.ts` |
| 4–6 | Kommo: jedna ustalona ścieżka (status „Do realizacji” → zlecenie) + observability | `kommo.js`, dokumenty `web/docs/kommo-*.md` |
| 6–8 | Panel kierownika: harmonogram + widok mapowy bez obietnic VRP | `Harmonogram.js`, `Ogledziny.js` |

**Kryterium ukończenia etapu 1:** 1 oddział pracuje **bez arkuszy** na codziennych zleceniach; Kommo **nie rozjechało** danych (logi sync, replay webhooków).

### Etap 2 — Logistyka (mies. 3–4)

**Cel:** planowanie z optymalizacją — **wersja 1 VRP** (np. 10–30 punktów, 1 dzień, ograniczenia czasu).

| Dostarczenie | Uwaga |
|--------------|--------|
| Model zadań: okna czasowe, czasy obsługi, priorytety | Rozszerzenie schematu + API |
| Silnik: **zewnętrzne API** (Google Routes / Mapbox) *albo* OR-Tools w workerze | Decyzja architektoniczna — wpisać w ofertę stałą cenę API |
| UI: „Auto-dispatch” + ręczna korekta | Za `web/` + ewentualnie `mobile/` |
| Test obciążeniowy: 50 zleceń × 10 ekip | Benchmark z §6 |

### Etap 3 — Finanse / BI (mies. 5–6)

**Cel:** marża per zlecenie + dashboard 6 oddziałów.

| Dostarczenie | Uwaga |
|--------------|--------|
| Model kosztu: stawki, paliwo, amortyzacja sprzętu, godziny | Tabele + importy / edycja |
| Raporty plan vs real | `Raporty.js` / nowe endpointy |
| Alerty (np. marża < próg) | Powiadomienia + `notifications` |

### Etap 4 — Komunikacja + utwardzenie (mies. 7–8)

**Cel:** SMS w cyklu życia, link statusowy, VRP z oknami, kompetencje w dispatchu.

| Dostarczenie | Uwaga |
|--------------|--------|
| Szablony SMS + zgody / rezygnacja | `sms` + polityka |
| Link statusowy + mapa | Publiczny, bezpieczny token |
| Ograniczenia kompetencji w solverze | Łączy Etap 2 z HR |

---

## C. Szablon odpowiedzi na pytania z §9 (do wklejenia do oferty)

*Instrukcja: wykonawca uzupełnia kolumnę „Odpowiedź”; Wewnętrznie możecie użyć kolumny „Stan ARBOR” jako self‑check.*

### 1. Kommo / amoCRM — synchronizacja

| Pytanie | Odpowiedź wykonawcy (szablon) | Stan ARBOR (skrót) |
|---------|-------------------------------|---------------------|
| Webhooks vs polling? Które zdarzenia? | … | Webhook outbound (`postKommoWebhook`), payload zlecenia — **polling tylko jako fallback?** opisać. |
| Idempotencja i kolejność zdarzeń? | … | Wymaga jawnego **replay / deduplikacji** w DB. |
| Konflikt: edycja w Kommo i w ARBOR w tym samym czasie? | … | Do zaprojektowania (wersjonowanie / „ostatnia zmiana wygrywa”). |

### 2. Silnik VRP

| Pytanie | Odpowiedź | Stan ARBOR |
|---------|-----------|-------------|
| Gotowe API vs własny algorytm? | … | Dziś: **heurystyki ETA / sloty**, nie pełny VRP. |
| Ograniczenia czasowe i kompetencyjne? | … | Częściowo w danych ekip; **solver** — nie. |
| Limit czasu obliczeń (50×10, <30 s)? | … | Do benchmarku. |

### 3. Offline mobilki

| Pytanie | Odpowiedź | Stan ARBOR |
|---------|-----------|-------------|
| Co działa offline (odczyt zapisów, kolejka POST)? | … | Jest **kolejka** `offline-queue.ts` + flush przy sieci. |
| Konflikty po sync (dwa telefony, ten sam work log)? | … | **Do zaprojektowania** (idempotency keys, server-side merge). |

### 4. Model marży

| Pytanie | Odpowiedź | Stan ARBOR |
|---------|-----------|-------------|
| Stawki per oddział, paliwo, serwis? | … | Rozproszone dane — **jeden silnik** do zbudowania. |
| Zamknięcie zlecenia = automatyczny kalkulator? | … | Epik produktowy. |

### 5. Skalowalność (~50 ekip)

| Pytanie | Odpowiedź | Stan ARBOR |
|---------|-----------|-------------|
| Test obciążeniowy, connection pooling, read replicas? | … | PostgreSQL + Express — **plan testów** przed produkcją. |

### 6. Storage zdjęć

| Pytanie | Odpowiedź | Stan ARBOR |
|---------|-----------|-------------|
| S3 / GCS / on-prem? Retencja, RODO? | … | `uploads`, `photos` w `os` — **polityka retencji** opisać. |

### 7. Czas i koszt etapów 1–4

| Etap | PLN (od–do) | Tygodnie / kamienie milowe | Zespół (role) |
|------|-------------|----------------------------|----------------|
| 1 | … | … | … |
| 2 | … | … | … |
| 3 | … | … | … |
| 4 | … | … | … |

---

## D. Oczekiwania z §10 — checklista oferty

- [ ] Cena rozbita na 4 etapy (tabela jak wyżej).
- [ ] Harmonogram tygodniowy + kamienie milowe mierzalne (np. „Etap 1: 1 oddział bez Excela”).
- [ ] Skład zespołu (PM, backend, mobile, integracje Kommo, DevOps).
- [ ] Case studies (FSM / Kommo).
- [ ] SLA wdrożenia i utrzymania (czas reakcji, RTO/RPO zgodnie z §6).

---

## E. Powiązane dokumenty w repo

| Temat | Plik |
|-------|------|
| Kommo (własna instancja, env) | `web/docs/kommo-wlasna-instancja.md` |
| Scenariusz Make / Kommo | `web/docs/kommo-make-scenariusz.md` |
| Dispatch / go-live | `web/docs/dispatch-pro-go-live-onepager.md` |
| Checklisty integracji | `web/docs/go-no-go-integrations.md` |

---

*Dokument roboczy — aktualizuj po każdej większej iteracji sprintu (zwłaszcza kolumnę „Stan w repozytorium”).*
