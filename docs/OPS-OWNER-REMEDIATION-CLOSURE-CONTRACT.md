# Ops Owner Remediation Closure Contract

## Cel

EPIC 9.14 domyka petle po auto-remediacji ownerow Kommo/SMS: owner lub dyrekcja moze oznaczyc alert jako realnie rozwiazany z Kontroli operacyjnej albo z pozycji digestu `owner_unresolved_after_remediation`.

## Backend

- `POST /api/ops/owner-alerts/resolve` przyjmuje `risk_id`, `risk_type`, opcjonalne `task_id`, `oddzial_id`, `source` (`control` albo `digest`) i `note`.
- Endpoint zapisuje `ops_action_events.action_type = risk_owner_resolve` z `follow_up=true`, `resolution_status=resolved`, `risk_id`, `risk_type`, ownerem i zrodlem.
- Endpoint zapisuje audyt `ops.owner_alert.resolve`.
- Dzienny digest traktuje `risk_owner_resolve` tak jak domkniecie follow-up: alert nie wraca do `owner_unresolved_after_remediation`.
- `risk_owner_resolve` jest osobnym typem decyzji, rozdzielonym od `risk_acknowledge`.

## Frontend

- Kontrola operacyjna pokazuje `Oznacz rozwiazane` przy niedomknietych alertach ownerow.
- Podglad digestu pokazuje ten sam przycisk przy szczegolach `owner_unresolved_after_remediation`.
- Po kliknieciu UI odswieza otwarte alerty, skutecznosc remediacji, historie decyzji i historie digestu.

## Weryfikacja

- `npm run verify:ops-owner-remediation-closure`
- `npm test -w arbor-os -- ops-kierownik-today.test.js`
- `npm test -w arbor-os -- opsDigest.test.js`
- `npm test -w arbor-web -- KontrolaOperacyjna.test.js`
