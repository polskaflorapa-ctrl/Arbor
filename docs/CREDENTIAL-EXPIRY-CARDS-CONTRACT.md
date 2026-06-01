# Credential expiry cards contract

Cel: HR i Kierownik widza na kartach pracownika, ktore uprawnienia wygasly albo wygasna niedlugo, zanim pracownik zostanie przypisany do ryzykownego zlecenia.

## Zakres

- `GET /api/hr/position-cards` zwraca dla kazdej karty pracownika:
  - `credential_expired_count`
  - `credential_expiring_count`
  - `credential_next_expiry`
  - `credential_status`
- `GET /api/hr/competency-expiry?days=90` zwraca `{ items, summary, horizon_days }`.
- `items[].expiry_status` ma wartosci `expired`, `critical` albo `warning`.
- `summary` liczy `expired`, `critical`, `warning` i `total`.
- Branch scope pozostaje taki jak w HR: Kierownik widzi swoj oddzial, Dyrektor/Admin/Prezes moze filtrowac.
- `HrPanel` pokazuje podsumowanie ryzyk w zakladce kompetencji.

## Reguly

- `expired`: `data_waznosci < CURRENT_DATE`.
- `critical`: `days_left <= 14`.
- `warning`: wpis miesci sie w horyzoncie zapytania, ale nie jest krytyczny.
- Karta pracownika ma `credential_status = expired`, jesli ma co najmniej jedno wygasle uprawnienie; `expiring`, jesli ma tylko wygasajace w 30 dni; w pozostalych przypadkach `ok`.

## GO

- `npm run verify:credential-expiry-cards` przechodzi.
- Test backendu potwierdza status uprawnien na kartach pracownika.
- Test backendu potwierdza summary dla wygaslych i krytycznych uprawnien.
- Panel HR obsluguje nowy format odpowiedzi.

## NO-GO

- Karta pracownika nie pokazuje liczby wygaslych/wygasajacych uprawnien.
- Endpoint kompetencji zwraca tylko surowa tablice bez summary.
- Kierownik widzi uprawnienia pracownikow spoza swojego oddzialu.
