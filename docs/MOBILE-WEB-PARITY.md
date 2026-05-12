# Parzystość funkcji: mobile → web

**Cel:** mieć jedną mapę „co jest gdzie” i **co trzeba dodać na web**, żeby pokryć to samo, co aplikacja mobilna (w tym magazyn, rezerwacje, raporty polowe itd.).

**Kontekst:** pełny zakres produktowy i epiki są też w [`ARBOR-full-scope-implementation-backlog.md`](./ARBOR-full-scope-implementation-backlog.md) — ten dokument skupia się na **trasach UI** (mobile `app/*.tsx` vs web `App.js` + `pages/`).

**Legenda statusu**

| Status | Znaczenie |
|--------|-----------|
| **Parity** | Na web jest dedykowany ekran / route odpowiadający temu przypadkowi (funkcja może różnić się detalami UX). |
| **Partial** | Jest powiązana strona web, ale brakuje części flow z mobile (np. podstron, akcji, widoku). |
| **Missing** | Brak odpowiednika w routingu web — do zaprojektowania strony + menu + ewentualnie API. |
| **N/A** | Tylko mobile (np. diagnostyka dev) albo tylko kontener layoutu. |

---

## Mapa ekranów (mobile → web)

| Mobile (`mobile/app/…`) | Web (route) | Status | Uwagi |
|-------------------------|-------------|--------|--------|
| `(tabs)/index.tsx` — start / tab główny | `#/dashboard` | **Partial** | Web: osobny dashboard; zestaw „kafelków” / skrótów może wymagać wyrównania z mobile. |
| `(tabs)/explore.tsx` | — | **Missing** | Eksploracja / skróty z taba — na web rozproszone po menu; ewentualnie jedna strona „start operacyjny”. |
| `login.tsx` | `#/` (`Login.js`) | **Parity** | |
| `dashboard.tsx` | `#/dashboard` | **Parity** | |
| `zlecenia.tsx` | `#/zlecenia` | **Parity** | |
| `zlecenie/[id].tsx` | `#/zlecenia/:id` | **Parity** | |
| `nowe-zlecenie.tsx` | `#/nowe-zlecenie` | **Parity** | |
| `harmonogram.tsx` | `#/harmonogram` | **Parity** | |
| `powiadomienia.tsx` | `#/powiadomienia` | **Parity** | |
| `profil.tsx` | — | **Missing** | Profil użytkownika / ustawienia konta na web (można częściowo spiąć z `#/uzytkownicy/:id` dla admina, nie dla „siebie”). |
| `rozliczenia.tsx` | `#/wynagrodzenie-wyceniajacych`, `#/rozliczenia-ekip` | **Partial** | Na mobile jeden moduł „rozliczenia”; na web są dwa obszary — sprawdzić, czy flow wyceniającego jest w 100% pokryty. |
| `raport-dzienny.tsx` | `#/raporty` (sekcje) | **Partial** | Raport dzienny polowy vs raporty web — wymaga audytu pól i eksportów. |
| `raporty-mobilne.tsx` | `#/raporty` | **Partial** | Ta sama „rodzina”, inna gęstość danych / filtry. |
| `oddzialy-mobile.tsx` | `#/oddzialy`, `#/oddzialy/:id` | **Parity** | |
| `uzytkownicy-mobile.tsx` | `#/uzytkownicy`, `#/uzytkownicy/:id`, `#/nowy-pracownik` | **Parity** | |
| `flota-mobile.tsx` | `#/flota` | **Parity** | |
| `magazyn-mobile.tsx` | `#/magazyn` (`MagazynWeb.js`) | **Parity (lokalnie)** | Ten sam klucz `magazyn_local_items_v1` co mobile (przeglądarka). Wspólny magazyn zespołowy = osobna praca (API). |
| `rezerwacje-sprzetu.tsx` | `#/rezerwacje-sprzetu` (`RezerwacjeSprzetu.js`) | **Parity (API)** | `GET/POST/PUT` `/api/flota/rezerwacje` + tabela `equipment_reservations` (migracja `os/migrate.sql`). |
| `wycena.tsx` | `#/wycena-kalendarz` / flow wycen | **Partial** | Zależnie od tego, co robi `wycena.tsx` vs kalendarz. |
| `wycena-kalendarz.tsx` | `#/wycena-kalendarz` | **Parity** | |
| `wycena-rysuj.tsx` | — | **Missing** | Rysowanie / szkic wyceny w terenie — na web osobny widok (tablet?) lub integracja z istniejącym flow. |
| `zatwierdz-wyceny.tsx` | `#/wycena-kalendarz` (redirect ze starego URL) | **Partial** | Sprawdzić zgodność akcji z mobile. |
| `wyceny-terenowe/*` | `#/wyceny-terenowe`, `#/wyceny-terenowe/:id` | **Parity** | |
| `ogledziny.tsx` | `#/ogledziny` | **Parity** | |
| `ogledziny-dokumentacja.tsx` | — | **Missing** | Dokumentacja z oględzin — osobna ścieżka lub zakładka pod `#/ogledziny`. |
| `blokady-kalendarza.tsx` | `#/wycena-kalendarz` (?) | **Partial** | Blokady — czy w pełni w kalendarzu web; jeśli nie, osobny widok lub panel. |
| `autoplan-dnia.tsx` | `#/autoplan-dnia` (`AutoplanDnia.js`) | **Parity (heurystyka web)** | Web ma warianty koszt / balans / szybkość, lokalne reguły, apply i rollback dla ról kierowniczych. |
| `misja-dnia.tsx` | `#/misja-dnia` (`MisjaDnia.js`) | **Parity (operacyjnie)** | Web ma KPI dnia, ETA, aktywne zlecenia, plan dnia i szybkie akcje. |
| `kpi-tydzien.tsx` | `#/raporty` lub `#/dashboard` | **Partial** | KPI tygodnia — rozstrzygnąć: osobna strona vs sekcja raportów / dashboardu. |
| `potwierdzenia-ekip.tsx` | `#/ekipy` / `#/harmonogram` | **Partial** | Potwierdzenia — sprawdzić, czy web ma te same akcje i stany. |
| `wyceniajacy-hub.tsx` | `#/wynagrodzenie-wyceniajacych` + `#/wyceny-terenowe` | **Partial** | „Hub” wyceniającego — na web rozbit na kilka modułów; możliwa jedna strona agregująca. |
| `wyceniajacy-finanse.tsx` | `#/wynagrodzenie-wyceniajacych` | **Partial** | |
| `kierownik` (jeśli jest w stacku tabów) | `#/kierownik` | **Parity** | Na web jest `Kierownik.js`. |
| `api-diagnostyka.tsx` | `#/integracje` lub panel dev | **Partial** | Diagnostyka API — web może mieć `DevPanel`; ujednolicić zakres. |
| `pomocnik.tsx` | — | **Missing** | Asystent / pomocnik — brak odpowiednika (ew. przyszły AI w web już jest `AiChat` — decyzja produktowa). |
| `test-mode.tsx` | `DevPanel` / brak | **Partial** | Tryb testowy — spięcie zachowania z web. |
| `oddzial-funkcje-admin.tsx` | `#/oddzialy/:id` | **Partial** | Funkcje admin oddziału — sprawdzić pokrycie zakładkami `OddzialDetail`. |

---

## Moduły tylko na web (nie porównujemy 1:1 z mobile)

Te ekrany są już na web; mobile ich nie musi mieć w tej samej formie:

- `#/klienci`, `#/crm/*`, `#/zarzadzaj-rolami`, `#/ksiegowosc`, `#/telefonia`, `#/integracje` itd.

Przy „wszystko na web” chodzi o **dodanie brakujących mobile-first funkcji** do web, nie o usuwanie web-only.

---

## Proponowana kolejność realizacji („wszystko”, ale etapami)

1. **Faza A — magazyn i zasoby** *(wdrożone: web + OS + testy OpenAPI)*  
   `magazyn-mobile`, `rezerwacje-sprzetu` → route’y web, menu, API OS (`equipment_reservations`), **`web/server` tryb full-stack**: `GET/POST /flota/rezerwacje`, `PUT /flota/rezerwacje/:id/status` + stan `equipmentReservations` w `state.json`; skróty na `#/dashboard`.

2. **Faza B — pole i raporty**  
   `misja-dnia`, `autoplan-dnia` → wdrożone jako dedykowane podstrony web + skróty w dashboardzie. Następne: `raport-dzienny`, `raporty-mobilne`, `kpi-tydzien`.

3. **Faza C — wyceny i kalendarz**  
   `wycena-rysuj`, `blokady-kalendarza`, dopięcie `zatwierdz-wyceny` vs mobile.

4. **Faza D — oględziny i dokumentacja**  
   `ogledziny-dokumentacja`, ewentualne pliki / załączniki.

5. **Faza E — hub wyceniającego i profil**  
   `wyceniajacy-hub`, `profil`, spójność z `#/wynagrodzenie-wyceniajacych`.

6. **Faza F — dev / test / diagnostyka**  
   `api-diagnostyka`, `test-mode` — spójnie z `DevPanel` i polityką środowisk.

---

## Jak odhaczać postęp

- Po dodaniu route na web: zmień w tej tabeli **Missing → Partial → Parity** i dopisz link do PR.
- Duże zmiany API trzymaj zsynchronizowane z [`ARBOR-full-scope-implementation-backlog.md`](./ARBOR-full-scope-implementation-backlog.md) (epiki **E6 zasoby / magazyn** itd.).

---

*Ostatnia aktualizacja mapy: wg struktury `mobile/app` i `web/src/App.js` w repozytorium.*
