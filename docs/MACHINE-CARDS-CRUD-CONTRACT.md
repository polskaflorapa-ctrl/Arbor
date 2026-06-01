# Machine cards CRUD contract

Scope: EPIC 6.1 gives managers a full equipment and vehicle card workflow in `#/flota`.

## User Flow

1. Manager opens `#/flota`.
2. Manager can create a vehicle or equipment card with branch and team assignment.
3. Manager can edit an existing vehicle or equipment card from the list row.
4. Manager can delete an existing vehicle or equipment card after confirmation.
5. Updated cards reload from the backend and remain visible in resource alert cards.

## API Contract

- `GET /api/flota/sprzet` and `GET /api/flota/pojazdy` remain the source of truth for cards.
- `POST /api/flota/sprzet` and `POST /api/flota/pojazdy` create cards.
- `PUT /api/flota/sprzet/:id` and `PUT /api/flota/pojazdy/:id` update cards, branch, and team assignment.
- `DELETE /api/flota/sprzet/:id` and `DELETE /api/flota/pojazdy/:id` remove cards.
- Non-director users can only update/delete resources from their own `oddzial_id`.
- Director/admin users may move resources between branches.

## GO

- `npm run verify:machine-cards-crud` passes.
- `npm test -w arbor-web -- Flota.test.js` passes.
- `npm test -w arbor-os -- flota-rezerwacje --runInBand` passes.

## NO-GO

- A manager can edit or delete a resource from another branch.
- Editing equipment drops team or branch assignment.
- UI only creates cards but cannot edit or delete them.
