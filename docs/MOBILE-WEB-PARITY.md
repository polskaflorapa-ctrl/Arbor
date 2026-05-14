# Parzystość funkcji: mobile → web

**Cel:** mieć jedną mapę „co jest gdzie” i **co trzeba dodać na web**, żeby pokryć to samo, co aplikacja mobilna (w tym magazyn, rezerwacje, raporty polowe itd.).

**Kontekst:** pełny zakres produktowy i epiki są też w `[ARBOR-full-scope-implementation-backlog.md](./ARBOR-full-scope-implementation-backlog.md)` — ten dokument skupia się na **trasach UI** (mobile `app/*.tsx` vs web `App.js` + `pages/`).

**Legenda statusu**


| Status      | Znaczenie                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| **Parity**  | Na web jest dedykowany ekran / route odpowiadający temu przypadkowi (funkcja może różnić się detalami UX). |
| **Partial** | Jest powiązana strona web, ale brakuje części flow z mobile (np. podstron, akcji, widoku).                 |
| **Missing** | Brak odpowiednika w routingu web — do zaprojektowania strony + menu + ewentualnie API.                     |
| **N/A**     | Tylko mobile (np. diagnostyka dev) albo tylko kontener layoutu.                                            |


---

## Mapa ekranów (mobile → web)


| Mobile (`mobile/app/…`)                 | Web (route)                                                | Status                | Uwagi                                                                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `(tabs)/index.tsx` — start / tab główny | `#/dashboard`                                              | **Partial**           | Web: osobny dashboard; zestaw „kafelków” / skrótów może wymagać wyrównania z mobile.                                                                               |
| `(tabs)/explore.tsx`                    | —                                                          | **Missing**           | Eksploracja / skróty z taba — na web rozproszone po menu; ewentualnie jedna strona „start operacyjny”.                                                             |
| `login.tsx`                             | `#/` (`Login.js`)                                          | **Parity**            |                                                                                                                                                                    |
| `dashboard.tsx`                         | `#/dashboard`                                              | **Parity**            |                                                                                                                                                                    |
| `zlecenia.tsx`                          | `#/zlecenia`                                               | **Parity**            |                                                                                                                                                                    |
| `zlecenie/[id].tsx`                     | `#/zlecenia/:id`                                           | **Parity**            |                                                                                                                                                                    |
| `nowe-zlecenie.tsx`                     | `#/nowe-zlecenie`                                          | **Parity**            |                                                                                                                                                                    |
| `harmonogram.tsx`                       | `#/harmonogram`                                            | **Parity**            |                                                                                                                                                                    |
| `powiadomienia.tsx`                     | `#/powiadomienia`                                          | **Parity**            |                                                                                                                                                                    |
| `profil.tsx`                            | `#/profil` (`Profil.js`)                                   | **Parity**            | Dane z `readStoredUser()`, motyw i język (LanguageSwitcher), wylogowanie (`localStorage.clear`), stawka/% jak na mobile. Bez biometryki/push — mobile-only.          |
| `rozliczenia.tsx`                       | `#/wynagrodzenie-wyceniajacych`, `#/rozliczenia-ekip`      | **Partial**           | Na mobile jeden moduł „rozliczenia”; na web są dwa obszary — sprawdzić, czy flow wyceniającego jest w 100% pokryty.                                                |
| `raport-dzienny.tsx`                    | `#/raport-dzienny` (`RaportDzienny.js`)                    | **Parity (API)**      | `GET/POST /api/raporty-dzienne`, szczegóły `GET …/:id`, wysyłka `POST …/:id/wyslij` — jak mobile (URL podpisu zamiast canvas w pierwszej iteracji).                |
| `raporty-mobilne.tsx`                   | `#/raporty-mobilne` (`RaportyMobilne.js`)                  | **Parity (API)**      | `GET /api/raporty/mobile` (+ alias `GET /api/mobile/reports` dla zakładki Eksploruj).                                                                              |
| `oddzialy-mobile.tsx`                   | `#/oddzialy`, `#/oddzialy/:id`                             | **Parity**            |                                                                                                                                                                    |
| `uzytkownicy-mobile.tsx`                | `#/uzytkownicy`, `#/uzytkownicy/:id`, `#/nowy-pracownik`   | **Parity**            |                                                                                                                                                                    |
| `flota-mobile.tsx`                      | `#/flota`                                                  | **Parity**            |                                                                                                                                                                    |
| `magazyn-mobile.tsx`                    | `#/magazyn` (`MagazynWeb.js`)                              | **Parity (API)**      | `GET /api/flota/sprzet`; Dyrektor widzi wszystkie oddziały, pozostałe role — własny oddział (filtr po stronie OS). localStorage usunięte.                           |
| `rezerwacje-sprzetu.tsx`                | `#/rezerwacje-sprzetu` (`RezerwacjeSprzetu.js`)            | **Parity (API)**      | `GET/POST/PUT` `/api/flota/rezerwacje` + tabela `equipment_reservations` (migracja `os/migrate.sql`).                                                              |
| `wycena.tsx`                            | `#/wycena-kalendarz` / flow wycen                          | **Partial**           | Zależnie od tego, co robi `wycena.tsx` vs kalendarz.                                                                                                               |
| `wycena-kalendarz.tsx`                  | `#/wycena-kalendarz`                                       | **Parity**            |                                                                                                                                                                    |
| `wycena-rysuj.tsx`                      | `#/wycena-rysuj` (`WycenaRysuj.js`)                        | **Parity (API)**      | `POST /wyceny/:id/zdjecia` lub `POST /quotations/.../zdjecia` + query `uri`, `wycenaId`, `quotationId`, `itemId`, `photoKind` (jak mobile).                        |
| `zatwierdz-wyceny.tsx`                  | `#/zatwierdz-wyceny` (`ZatwierdzWyceny.js`)                | **Parity (API)**      | Zakładki statusów, `POST /wyceny/:id/zatwierdz`, `POST /wyceny/:id/odrzuc` — role jak mobile.                                                                      |
| `wyceny-terenowe/`*                     | `#/wyceny-terenowe`, `#/wyceny-terenowe/:id`               | **Parity**            |                                                                                                                                                                    |
| `ogledziny.tsx`                         | `#/ogledziny`                                              | **Parity**            |                                                                                                                                                                    |
| `ogledziny-dokumentacja.tsx`            | `#/ogledziny-dokumentacja` (`OgledzinyDokumentacja.js`)    | **Parity (API)**      | Zdjęcie → `#/wycena-rysuj` z `wycenaId`; wideo → `POST /api/ogledziny/:id/media` (pole `wideo`). Szczegóły oględzin pokazują listę `media` z `GET /ogledziny/:id`. |
| `blokady-kalendarza.tsx`                | `#/blokady-kalendarza` + integracja w `#/wycena-kalendarz` | **Parity (lokalnie)** | Ten sam klucz `calendar_blocks_v1` co mobile; kalendarz wycen oznacza zablokowane dni i blokuje zapis nowej wyceny.                                                |
| `autoplan-dnia.tsx`                     | `#/autoplan-dnia` (`AutoplanDnia.js`)                      | **Parity (API)**      | Ta sama heurystyka planu + PUT `/tasks/:id`; historia/reguły w `localStorage` jak mobile. Powiadomienia dzienne — tylko mobile (push).                             |
| `misja-dnia.tsx`                        | `#/misja-dnia` (`MisjaDnia.js`)                            | **Parity (API)**      | `GET /tasks/moje                                                                                                                                                   |
| `kpi-tydzien.tsx`                       | `#/kpi-tydzien` (`KpiTydzien.js`)                          | **Parity (lokalnie)** | Agregacja z `autoplan_history_v1` (zsynchronizowana z mobile przy wspólnej przeglądarce).                                                                          |
| `potwierdzenia-ekip.tsx`                | `#/potwierdzenia-ekip` (`PotwierdzeniaEkip.js`)            | **Parity**            | Ten sam klucz localStorage `crew_attendance_log_v1` co mobile; ekipy z API, date picker, switch per ekipa, notatka na blur, stats bar (gotowych/brak/łącznie).     |
| `wyceniajacy-hub.tsx`                   | `#/wyceniajacy-hub`                                        | **Parity**            | Hub wyceniającego — GET `/api/ogledziny`, filtrowanie po oddziale i wyceniającym, KPI (zaplanowane/pozostało/zakończone), szybkie akcje + workflow + Sidebar + Dashboard. |
| `wyceniajacy-finanse.tsx`               | `#/wynagrodzenie-wyceniajacych`                            | **Partial**           |                                                                                                                                                                    |
| `kierownik` (jeśli jest w stacku tabów) | `#/kierownik`                                              | **Parity**            | Na web jest `Kierownik.js`.                                                                                                                                        |
| `api-diagnostyka.tsx`                   | `#/integracje` lub panel dev                               | **Partial**           | Diagnostyka API — web może mieć `DevPanel`; ujednolicić zakres.                                                                                                    |
| `pomocnik.tsx`                          | —                                                          | **Missing**           | Asystent / pomocnik — brak odpowiednika (ew. przyszły AI w web już jest `AiChat` — decyzja produktowa).                                                            |
| `test-mode.tsx`                         | `DevPanel` / brak                                          | **Partial**           | Tryb testowy — spięcie zachowania z web.                                                                                                                           |
| `oddzial-funkcje-admin.tsx`             | `#/oddzialy/:id` tab "⚙️ Funkcje" (`OddzialDetail.js`)    | **Parity**            | 4. zakładka Funkcje (Dyrektor/Administrator) — 22 feature flagi mobilne, toggle + localStorage `oddzial_feature_overrides_v1`, eksport JSON do schowka.            |


---

## Moduły tylko na web (nie porównujemy 1:1 z mobile)

Te ekrany są już na web; mobile ich nie musi mieć w tej samej formie:

- `#/klienci`, `#/crm/`*, `#/zarzadzaj-rolami`, `#/ksiegowosc`, `#/telefonia`, `#/integracje` itd.

Przy „wszystko na web” chodzi o **dodanie brakujących mobile-first funkcji** do web, nie o usuwanie web-only.

---

## Proponowana kolejność realizacji („wszystko”, ale etapami)

1. **Faza A — magazyn i zasoby** *(wdrożone: web + OS + testy OpenAPI)*
  `magazyn-mobile`, `rezerwacje-sprzetu` → route’y web, menu, API OS (`equipment_reservations`), `**web/server` tryb full-stack**: `GET/POST /flota/rezerwacje`, `PUT /flota/rezerwacje/:id/status` + stan `equipmentReservations` w `state.json`; skróty na `#/dashboard`.
2. **Faza B — pole i raporty** *(wdrożone: raport dzienny, KPI mobilne, misja dnia, autoplan, KPI tygodnia)*
  Route’y web + API OS `GET /raporty/mobile` (koszt z `task_rozliczenie`). Historia autoplanu / reguły — `localStorage` zsynchronizowana z kluczami mobile.
3. **Faza C — wyceny i kalendarz** *(wdrożone: `wycena-rysuj`, `blokady-kalendarza`, `zatwierdz-wyceny`, blokady w `wycena-kalendarz`)*
  Trasy `#/wycena-rysuj`, `#/blokady-kalendarza`, `#/zatwierdz-wyceny`; menu / dashboard / i18n.
4. **Faza D — oględziny i dokumentacja** *(wdrożone: route web, `POST /ogledziny/:id/media` w OS, tabela `ogledziny_media`, mock `web/server`)*
  `ogledziny-dokumentacja`, upload wideo, podgląd w szczegółach oględzin.
5. **Faza E — hub wyceniającego i profil** *(w pełni wdrożone: `#/wyceniajacy-hub`, `#/profil`, menu + skrót na dashboardzie + translacje)*
  `WyceniajacyHub.js` (GET `/api/ogledziny`, KPI, akcje, workflow), `Profil.js` (dane, motyw, język, wylogowanie), integracja w Sidebar + Dashboard, tłumaczenia (pl/uk/ru).
6. **Faza F — dev / test / diagnostyka**
  `api-diagnostyka`, `test-mode` — spójnie z `DevPanel` i polityką środowisk.

---

## Jak odhaczać postęp

- Po dodaniu route na web: zmień w tej tabeli **Missing → Partial → Parity** i dopisz link do PR.
- Duże zmiany API trzymaj zsynchronizowane z `[ARBOR-full-scope-implementation-backlog.md](./ARBOR-full-scope-implementation-backlog.md)` (epiki **E6 zasoby / magazyn** itd.).

---

*Ostatnia aktualizacja mapy: wg struktury `mobile/app` i `web/src/App.js` w repozytorium.*