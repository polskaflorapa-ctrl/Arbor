# CMR + CRM — checklista do jesieni (P0 / P1 / P2)

**Cel:** jednoznaczna definicja „skończone” — zamykaj punkty w kolejności priorytetu.  
**Zasada:** nowe wymagania wchodzą tylko kosztem wyrzucenia z listy lub przesunięcia terminu.

---

## Legenda


| Priorytet | Znaczenie                                                                        |
| --------- | -------------------------------------------------------------------------------- |
| **P0**    | Bez tego nie ma „wersji do produkcji” / użytkownik nie może bezpiecznie pracować |
| **P1**    | Wymagane do pełnego domknięcia planu biznesowego (spójność, mobile, integracja)  |
| **P2**    | Warto mieć; można po jesieni lub w kolejnej iteracji                             |


Status przy punkcie: `[ ]` nie zrobione · `[x]` zrobione

---

## P0 — produkcja i bezpieczeństwo

- **Migracja DB (OS):** `cmr_lists` + indeksy z `os/migrate.sql` wykonane na **docelowej** bazie (staging → prod), backup przed migracją.
- **Wdrożenie OS:** wersja z trasami `/api/cmr`, `/api/pdf/cmr/:id` zgodna z repo; smoke po deployu.
- **Wdrożenie web:** build + serwer; `REACT_APP_API_URL` / proxy wskazują na właściwy backend.
- **Sekrety:** `KOMMO_WEBHOOK_URL` (i ewent. `KOMMO_WEBHOOK_SECRET_`*) ustawione tylko na serwerze, nie w repozytorium.
- **Smoke API:** w katalogu `web` przy włączonym backendzie: `node ./scripts/smoke-cmr.cjs` — szczegóły [smoke-cmr-5min.md](./smoke-cmr-5min.md).
- **Smoke CMR (UI):** utworzenie CMR z zleceniem → zapis → PDF → edycja → (opcjonalnie) push Kommo przy skonfigurowanym webhooku.
- **Smoke role:** Dyrektor / Kierownik / użytkownik z ekipą — widoczność list CMR zgodna z polityką (zlecenie / autor przy braku zlecenia).

---

## P1 — domknięcie „wszystko” w sensie produktu

- **Kommo:** ustawione rzeczywiste ID (`KOMMO_PIPELINE_ID`, `KOMMO_STATUS_ID`, `KOMMO_CF_`*) pod Wasz szablon leadów; test end-to-end na stagingu.
- **Regresja `/api/tasks/stats`:** brak 400 po zalogowaniu (lokalnie już OK — potwierdzić na wdrożonym API).
- **Strona `/crm`:** treści / linki sprawdzone z biznesem; `REACT_APP_KOMMO_APP_URL` ustawione tam, gdzie ma być przycisk do Kommo.
- **Dokumentacja operacyjna (krótka):** 1 strona dla użytkownika: „CMR vs CRM”, gdzie klikać, co znaczy synchronizacja Kommo.
- **Mobile (jeśli w zakresie „wszystko”):** spójność z web — nawigacja do CRM hub i/lub CMR albo świadoma decyzja „poza zakresem jesieni”.

---

## P2 — porządek techniczny i rozszerzenia

- **Schemat `cmr_lists.oddzial_id`:** decyzja — zostawić NULL na zawsze vs migracja `DROP COLUMN` (kosmetyka schematu).
- **Kommo zaawansowane:** OAuth, dwukierunkowa synchronizacja leadów, webhooks przychodzące — **osobny epik**, nie blokuje zamknięcia P0/P1.
- **Testy automatyczne:** minimalny zestaw API (CMR CRUD + stats) jeśli macie standard CI.
- **Monitoring:** logi / alert przy systematycznym błędzie `kommo-push` (502, timeout).

---

## Już zrobione (referencja — nie kopiuj do sprintu jako zadania)

- CMR: web UI, lokalne API + PDF, OS routes + PDF, i18n, `ZlecenieDetail` ↔ CMR.
- Kommo: webhook push, podgląd payloadu, mapowanie pól (w tym oddział **ze zlecenia**).
- CRM: strona `/crm`, menu, rozróżnienie CRM vs CMR.
- Dev: `dev-full-smart`, `status:web`, poprawka routingu `/tasks/stats`.
- CMR bez pola „oddział” na rekordzie; widoczność i Kommo ustalone zgodnie z ustaleniami w kodzie.

---

## Definicja „skończone na jesień” (minimum)

Wszystkie punkty **P0** zamknięte + z **P1** co najmniej: **Kommo na stagingu**, **smoke role**, **dokumentacja krótka**, oraz **jasna decyzja** co do mobile (zrobione lub świadomo poza zakresem).

---

*Ostatnia aktualizacja checklisty: szablon utworzony w repo — uzupełniaj `[x]` przy commitach / release.*