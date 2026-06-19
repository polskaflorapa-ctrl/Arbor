# Money Flow Readiness

Cel: przeplyw landing demo -> CRM lead -> klient -> zlecenie -> finish payment -> faktura ma byc odporny na ciche zgubienie przychodu.

## GO

- Publiczny landing demo zapisuje lead albo kolejkuje go lokalnie do ponowienia.
- Konwersja landing demo tworzy lub podlacza klienta i CRM lead, a `crm_lead_id` jest widoczne w panelu demo.
- Faktury uzywaja transakcji i `pg_advisory_xact_lock`, zeby numeracja per rok/oddzial nie tworzyla duplikatow przy rownoleglym wystawianiu.
- Pozycje faktury sa walidowane: ujemna cena netto i VAT poza zakresem koncza sie `VALIDATION_FAILED`.
- Kierownik widzi i zmienia status tylko faktur swojego oddzialu.
- Finish platnego zlecenia z forma `Brak` wymaga uzasadnienia i zwraca `PAYMENT_MISSING_REASON_REQUIRED`.
- Finish zapisuje `task_client_payments` i `task_calc_log`, zeby rozliczenie mialo slad audytowy.

## NO-GO

- Demo request konczy sie tylko klientem bez CRM lead.
- Panel demo nie pokazuje `crm_lead_id` albo nie prowadzi do pipeline.
- Faktura moze dostac ujemna pozycje albo numer policzony poza transakcja.
- Brak platnosci przy platnym zleceniu przechodzi bez notatki.
- Testy `demoRequests`, `ksiegowosc`, `tasks` albo `taskSettlement` nie przechodza.

## Guard

Uruchom:

```bash
npm run verify:money-flow
npm test -w arbor-os -- tests/demoRequests.test.js tests/ksiegowosc.test.js tests/tasks.test.js tests/taskSettlement.test.js --runInBand
```

`verify:money-flow` pilnuje kontraktu kodu i testow, a testy sprawdzaja zachowanie endpointow.
