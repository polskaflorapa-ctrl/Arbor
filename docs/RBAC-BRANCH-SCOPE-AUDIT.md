# RBAC branch scope audit

Cel: miec jedna bramke, ktora pilnuje, ze role ARBOR nie wyciekaja poza oddzial i nie pokazuja finansow rolom operacyjnym.

Zakres: JWT, backend `os`, web route guards, branch-scoped dane, audit log i najwazniejsze zapisy.

## 1. Macierz minimalna

| Rola | Zakres danych | Finanse | Kluczowe uprawnienia |
| --- | --- | --- | --- |
| Prezes / Dyrektor | wszystkie oddzialy | tak | BI, eksporty, uzytkownicy, oddzialy, Kommo/SMS, audit |
| Administrator | wszystkie oddzialy | tak | konfiguracja, uzytkownicy, oddzialy, Kommo/SMS, audit |
| Kierownik | tylko `oddzial_id` z JWT | nie | zlecenia oddzialu, planowanie, ekipy, SMS, branch-scoped audit |
| Brygadzista / Pomocnik | tylko przypisana ekipa | nie | START/STOP/finish, zdjecia, problem, offline sync |
| Wyceniajacy / Specjalista | zakres pracy wycen/biura | nie | wyceny i dozwolone akcje backoffice bez globalnych finansow |

## 2. Bramka lokalna

```powershell
cd C:\Users\paha1\arbor
npm run verify:rbac-scope
npm run verify:pilot-hardening
npm run check
```

`verify:rbac-scope` jest statyczna bramka repo. Nie laczy sie z baza, ale pilnuje guardow, dokumentow i testow dla krytycznych miejsc.

## 3. Backend guardy

Wymagane punkty kontrolne:

- `/api/auth/login` zapisuje w JWT: `id`, `login`, `rola`, `oddzial_id`, `ekipa_id`.
- `buildAppPermissions()` zwraca `taskScope` i flagi `canViewFinance`, `canManageUsers`, `canViewAllBranches`.
- `scopedOddzialId()` daje Dyrektor/Admin zakres globalny, a pozostalym role ogranicza do `req.user.oddzial_id`.
- `requireOddzialBody()` blokuje zapis do cudzego `oddzial_id`.
- `tasks.js` uzywa `getTaskScope()` i `requireTaskAccess` dla list, szczegolow, zdjec, dokumentow, START/STOP/finish i problemow.
- `bi.js` pozwala Kierownikowi wejsc do BI tylko branch-scoped i usuwa pola finansowe, gdy `canViewTaskFinance()` jest false.
- `audit.js` dopuszcza Kierownika, ale `listAuditLogs()` musi scope'owac wynik po oddziale.
- `uzytkownicy.js` blokuje Kierownikowi tworzenie wysokich rol i zarzadzanie uzytkownikami spoza oddzialu.
- `dispatch.js`, `ops.js`, `sms.js`, `telephony.js` musza respektowac `oddzial_id` przy akcjach operacyjnych.

## 4. Web guardy

Wymagane punkty kontrolne:

- `ProtectedRoute` respektuje `roles` i `require`.
- `App.js` ma `ADMIN`, `MGMT`, `SALES`, `WYCENY`, `FINANCE`.
- `/uzytkownicy`, `/oddzialy`, `/zarzadzaj-rolami`, `/kontrola-operacyjna` sa admin-only.
- `/ksiegowosc` jest `FINANCE`.
- `/bi`, `/telefonia`, `/integracje`, `/auto-dispatch`, `/kierownik` sa management-scoped.
- `permissions.js` ma fallback bezpieczny: brak permissions nie daje finansow.

## 5. Testy funkcjonalne do przebiegu pilota

Minimalny manualny przebieg:

1. Kierownik z oddzialu A probuje pobrac albo edytowac zlecenie oddzialu B: oczekiwane 403 albo brak rekordu.
2. Kierownik otwiera BI drill: widzi dane operacyjne, ale bez `financials`, `wartosc_netto_do_rozliczenia`, kosztow i marzy.
3. Brygadzista otwiera mobile: widzi tylko zlecenia przypisanej ekipy.
4. Brygadzista probuje wejsc w SMS/Kommo/BI/audit: oczekiwane 403 albo brak widoku.
5. Administrator widzi wszystkie oddzialy i moze zmienic `oddzial_id`, ale tylko z audytem.
6. Audit dla Kierownika pokazuje tylko jego oddzial.

## 6. GO / NO-GO

GO:

- `npm run verify:rbac-scope` przechodzi.
- `npm run verify:pilot-hardening` przechodzi.
- `npm run check` przechodzi.
- Kierownik jest branch-scoped w listach, zapisach i audit.
- Brygadzista/Pomocnik sa team-scoped i field-only.
- Tylko Prezes/Dyrektor/Administrator maja `canViewFinance=true`.

NO-GO:

- Kierownik moze ustawic cudzy `oddzial_id`.
- Kierownik widzi finansowe pola BI drill albo eksporty finansowe.
- Brygadzista widzi SMS, Kommo, BI, audit albo panele admina.
- Brak `oddzial_id` w JWT dla rol branch-scoped.
- Web pokazuje admin-only route rolom operacyjnym.
