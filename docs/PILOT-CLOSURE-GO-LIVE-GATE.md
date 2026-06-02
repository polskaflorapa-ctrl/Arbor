# Pilot closure go-live gate

Cel: ostatnia bramka przed uruchomieniem pilota jednego oddzialu. Ten dokument nie zastepuje runbookow modulowych; spina je w jeden minimalny zestaw dowodow GO / NO-GO.

Zakres: jedno srodowisko, jeden oddzial, realny Kierownik, realny Brygadzista, minimum 3 zlecenia testowe przechodzace od wejscia do rozliczenia.

## 1. Kolejnosc bramki

Uruchom przed decyzja GO:

```powershell
cd C:\Users\paha1\arbor
npm run status:json:strict
npm run pilot:gates:run -- --date YYYY-MM-DD --continue-on-fail
npm run verify:pilot-closure
npm run verify:pilot-hardening
npm run verify:rbac-scope
npm run verify:kommo-idempotency-retry
npm run verify:kommo-sms-drill
npm run verify:backup-rpo
npm run verify:observability
npm run verify:web-tti
npm run check
npm run smoke:critical-path
npm run smoke:operational
npm run smoke:demo:e2e
```

Uruchom dodatkowo, jesli pilot obejmuje build mobilny albo publiczne srodowisko:

```powershell
npm run verify:mobile
npm run smoke:mobile -w arbor-mobile
npm run deploy:prod:dry-run
npm run smoke:p95 -- https://<arbor-os-url> --threshold 500 --samples 5
npm run smoke:web:tti -- https://<arbor-web-url> --threshold 3000
```

## 2. Dowody wymagane

- Wynik `npm run status:json:strict`.
- Wynik `npm run check`.
- Wynik `npm run verify:pilot-closure`.
- Wyniki smoke: `smoke:critical-path`, `smoke:operational`, `smoke:demo:e2e`.
- Dowod RBAC: Kierownik branch-scoped, Brygadzista field-only, Dyrektor/Admin z finansami.
- Dowod mobile offline: START, zdjecie/problem i finish bez duplikatow po sync.
- Dowod Kommo: outbound retry/dead-letter, inbound idempotency/conflict diagnostics.
- Dowod SMS/Zadarma: delivery events albo swiadome wylaczenie SMS w decyzjach.
- Dowod backup/restore: aktualny backup po migracjach i restore dry-run.
- Dowod wydajnosci: p95 API i TTI web pod progami albo zapisany NO-GO.

## 3. Manualny przebieg A-Z

1. Kierownik tworzy lub odbiera zlecenie z Kommo.
2. Zlecenie ma klienta, adres, oddzial, okno, zakres, wartosc i wymagania sprzetu/kompetencji.
3. Auto-dispatch planuje albo zwraca czytelne blokady.
4. Kierownik zapisuje plan i widzi go w Harmonogramie oraz cockpitcie.
5. Brygadzista widzi zlecenie w mobile.
6. Brygadzista wykonuje START z GPS.
7. Brygadzista dodaje zdjecie "Przed", problem i zdjecie "Po".
8. Co najmniej jedna akcja mobile jest wykonana offline i pozniej zsynchronizowana.
9. Brygadzista robi finish z materialami i kosztami operacyjnymi.
10. Kierownik widzi logi, zdjecia, problem, koszty i ryzyka zgodnie z rola.
11. Dyrektor/Admin potwierdza BI drill, marze i eksporty finansowe.
12. Kommo outbound package albo diagnostyka retry/dead-letter jest sprawdzona.

## 4. Decyzja GO

GO, jesli:

- wszystkie automatyczne bramki z sekcji 1 przechodza albo maja podpisany wyjatek;
- manualny przebieg A-Z przechodzi na minimum 3 zleceniach;
- offline nie tworzy duplikatow i nie blokuje calej kolejki;
- role nie przeciekaja danych finansowych ani cudzych oddzialow;
- Kommo/SMS sa zielone albo swiadomie wylaczone z zapisem decyzji;
- backup i restore dry-run sa aktualne.

## 5. Decyzja NO-GO

NO-GO, jesli:

- `npm run check`, `npm run verify:pilot-closure` albo `npm run smoke:critical-path` nie przechodzi;
- START/STOP/finish moze zgubic dane bez widocznego bledu;
- offline queue tworzy duplikaty lub nie raportuje konfliktu;
- Kierownik albo Brygadzista widzi dane spoza roli;
- Kommo/SMS sa wlaczone, ale bledy nie trafiaja do diagnostyki;
- nie ma aktualnego backupu po migracjach;
- p95 API albo TTI web przekracza prog bez zaakceptowanego wyjatku.

## 6. Artefakt decyzji

Po probie zapisz:

- date i srodowisko;
- ID oddzialu, ekip i zlecen testowych;
- liste komend z wynikami PASS/FAIL;
- screenshoty web/mobile z kluczowych ekranow;
- liste wyjatkow z wlascicielem i terminem;
- decyzje GO albo NO-GO podpisana przez wlasciciela pilota.

Uzyj szablonu `docs/PILOT-GO-NO-GO-DECISION-TEMPLATE.md`, a wypelniony raport zapisz w `docs/pilot-runs/`. Najprosciej utworzyc raport komenda `npm run pilot:run:new -- --date YYYY-MM-DD`, a automatyczne wyniki bramek zebrac przez `npm run pilot:gates:run -- --date YYYY-MM-DD --continue-on-fail`. Bramka `npm run verify:pilot-execution` pilnuje, ze szablon zawiera wymagane pola decyzji, wyniki smoke, wyjatki i podpis GO/NO-GO.
