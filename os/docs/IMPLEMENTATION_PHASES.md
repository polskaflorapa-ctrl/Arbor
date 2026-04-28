# ARBOR-OS — wdrożenie fazowe (backlog)

**Cel:** Rozłożyć pełną specyfikację (~70 funkcji F1.x–F11.x) na kolejne iteracje z jasnymi zależnościami i kryteriami „done”.

**Zasady pracy fazowej**

1. **Migracja przed API/UI** — każda faza z nowymi tabelami zaczyna się od `os/migrate.sql` + smoke na stagingu.
2. **Kontrakt API** — po stabilizacji endpointu: wpis w `os/docs/openapi.yaml`.
3. **Równolegle:** OS (`os/`) → web (`web/`) → mobile (`mobile/`), jeśli funkcja ma trzy powierzchnie.
4. **Numeracja F** — w commitach i PR: `F11.4: …` ułatwia śledzenie.

---

## Faza 0 — Inwentaryzacja i pasek jakości (bieżąca)

| ID | Zakres | Done = |
|----|--------|--------|
| F0.1 | ~~Mapowanie nazw tabel M11 spec ↔ repo (`user_payroll_rates` vs „employee_rates” itd.).~~ | Komentarz **F0.1** w `os/migrate.sql` (nad `user_payroll_rates`) — słownik tabel i aliasów dokumentacyjnych |
| F0.2 | ~~`task_calc_log` + zapis przy `POST /tasks/:id/finish`~~ | Migracja `task_calc_log` + `INSERT` w `os/src/routes/tasks.js` przy finish |
| F0.3 | ~~Smoke: login, lista zleceń, finish z płatnością, eksport payroll~~ | `npm run smoke:f03` + `npm run smoke:user` (`smoke_admin`, `smoke_brygadzista` + ekipa w DB). Opcjonalnie: `SMOKE_FINISH_TASK_ID`; ścieżka płatności: `SMOKE_TEAM_LOGIN=smoke_brygadzista` + `SMOKE_TEAM_PASSWORD` + env finish (`SMOKE_FINISH_FORMA`, `SMOKE_FINISH_KWOTA`, `SMOKE_FINISH_LAT`/`LNG`, `SMOKE_FINISH_NIP`) |

---

## Faza 1 — M11 Rozliczenia (domknięcie rdzenia)

**Dlaczego pierwsze:** Zasilane danymi z M3 (finish, płatność, extra work) — bez spójnego M11 reszta raportów finansowych jest słaba.

| Priorytet | Funkcja | Opis techniczny (skrót) |
|-----------|---------|-------------------------|
| P1 | **F11.2** | ~~`payrollTeamDay`: nadgodziny (>8h), święta PL, weekend; noc (okna 22–06 PL, `PAYROLL_NIGHT_*`, `night_multiplier`); tabela `daily_payroll` — snapshot linii przy `GET /payroll/export.csv` i `/export.zip` (wyłączenie: `PAYROLL_EXPORT_SNAPSHOT=0`).~~ |
| P1 | **F11.4** | ~~Payload + blokady; lista/korekty UI; tabela `payroll_line_correction_log` przy PATCH; `GET /payroll/line-correction-log` + podgląd; `GET /payroll/line-correction-log.csv` + przycisk w web.~~ |
| P2 | **F11.5** | ~~Tick kasa + in-app; SMS (`PAYROLL_CASH_REMINDER_SMS=1`, Twilio); e-mail (`PAYROLL_CASH_REMINDER_EMAIL=1`, SMTP z env).~~ |
| P2 | **F11.8** | ~~Powiadomienia in-app (`typ: raport_dnia_ekipy`) po zatwierdzeniu raportu.~~ Push Expo: tabela `user_expo_push_tokens`, `POST/DELETE /mobile/me/push-token`, wysyłka z `payrollNotify` (`PAYROLL_PUSH_ENABLED`, opcj. `EXPO_ACCESS_TOKEN`), mobile rejestracja + deep link `/powiadomienia`. |
| P2 | **F11.7** | ~~Blokada eksportu; status miesiąca; web; `GET /payroll/export.zip` (ZIP + `manifest.json` z SHA-256; opcj. HMAC `PAYROLL_ZIP_MANIFEST_HMAC_SECRET`; hasło ZIP: `PAYROLL_ZIP_PASSWORD`, opcj. `PAYROLL_ZIP_ENCRYPTION_METHOD=aes256|zip20`).~~ |
| P3 | **F11.1** | ~~UI web: panel stawek M11 (`PayrollRatesPanel`) na karcie użytkownika + trasa `/uzytkownicy/:id` → otwarcie szczegółów; pola pracownika w eksporcie miesiąca (CSV / Symfonia / Optima / Comarch / ZIP).~~ |

**Kryterium ukończenia fazy 1:** Kierownik może zamknąć miesiąc: raporty dni → zatwierdzenia → eksport bez ręcznego SQL; pracownik widzi orientacyjne kwoty w mobile.

---

## Faza 2 — M3 Mobile brygadzisty (zgodność z F3)

| Priorytet | Funkcja | Uwagi |
|-----------|---------|--------|
| P1 | **F3.5–F3.7** | ~~Walidacja przy finish (ekipa): zdjęcie „Po” (`TASK_FINISH_REQUIRE_PO_PHOTO=1`), opcj. „Przed” (`TASK_FINISH_REQUIRE_PRZED_PHOTO=1`), zużycie `zuzyte_materialy` → `task_finish_material_usage` + wymóg listy (`TASK_FINISH_REQUIRE_MATERIAL_USAGE=1`). Mobile: multipart `/tasks/:id/zdjecia`, start z checklistą GPS, pole zużycia w modalu finish.~~ |
| P1 | **F3.8** | Offline: kolejka AsyncStorage (multipart zdjęcia + JSON: status/start/finish/extra/problem); flush przy `AppState active`, co 30 s oraz **`expo-network` `addNetworkStateListener`** po powrocie sieci (`OfflineQueueSync`). 2B: **idempotencja** — `Idempotency-Key` + `api_idempotency_log`, OS: start/stop/finish/status, problem(y), extra-work create/accept; mobilka: `flushOfflineQueue`. Konflikty / pełna replika listy — TODO. |
| P2 | **F3.3 / F3.6** | ~~Wymuszone Przed/Po przy finish: env `TASK_FINISH_REQUIRE_*` + walidacja w `tasks.js`; mobile: `finish_requirements` z `GET /tasks/:id`, blokada „Zakończ” + banner + zużycie materiału w modalu.~~ Edytor adnotacji / rozszerzenia UI — opcjonalnie dalej. |

---

## Faza 3 — M1 Wycena u klienta (dopiecie vs F1.5–F1.12)

- F1.10 SLA eskalacje (job + tablica SLA).
- F1.11 PDF + wysyłka (istniejące ścieżki `pdf` / SMS — spięcie statusów).
- F1.12 Public accept → task (webhook Kommo).

---

## Faza 4 — M4 Panel kierownika + M6 komunikacja

- F4.1 / F2.6: DnD harmonogram (zależy od modelu planu w DB).
- F6.1–F6.4: SMS szablony + okna czasowe (konfig + integracja z planem dnia).

---

## Faza 5 — M2 AI Dispatcher

- F2.1–F2.5: VRP / klasteryzacja — **osobny serwis lub moduł** `os/src/services/dispatch/`; bez tego F2.5 tylko stub UI.

---

## Faza 6 — M5 BI Dyrektor

- F5.1–F5.4: agregacje SQL + cache 15 min + kafelki oddziałów na web.

---

## Faza 7 — M7 Zasoby, M8 HR, M9 Kommo, M10 Admin

- Równolegle według priorytetu biznesu: magazyn (M7), ewidencja HR (M8 — częściowo pokrywa się z M11 godzinami), dwukierunkowy Kommo (M9), twardy RBAC/2FA (M10).

---

## Następny krok (rekomendacja na pierwszą iterację „pracy”)

W kolejności:

1. **Faza 0.3** — ~~smoke `npm run smoke:f03` + seed `npm run smoke:user` (w tym `smoke_brygadzista`).~~
2. **Faza 1 / F11.2** — ~~święta PL + nadgodziny (>8 h) + praca nocna (mnożnik z kartą stawek) w `payrollTeamDay.js`.~~
3. **Faza 1 / F11.4** — ~~payload w `payroll_team_day_reports` + mobile zamknięcie dnia (`/mobile/me/team-day-close`).~~ Dalsze pola w mobile (np. podgląd kasy w UI) — według potrzeb.
4. **Faza 2 / F3.5–F3.7** — ~~walidacja „Po” / zużycie przy finish, mobile multipart + zużycie w modalu, testy Jest.~~
5. **Faza 2 / F3.8** — offline: kolejka (2A: zdjęcia, 2B: reszta) albo **F3.3 / F3.6** — wymuszone Przed/Po + adnotacje.

Ten plik można aktualizować przy każdej merge’owanej fazie (checkboxy w PR opisie: „Phase 1 P1 done”).
