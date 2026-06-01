# Dispatcher day plan load contract

Scope: EPIC 3.5 closes the manager-facing handoff from a saved dispatcher result into the day schedule.

## User flow

1. Manager opens `#/harmonogram?date=YYYY-MM-DD&view=dzien`.
2. Manager clicks `Wczytaj plan dispatchera` in `Centrum planowania ekip`.
3. Web calls `GET /api/dispatch/plans` with `limit=50` and branch scope when available.
4. Web selects the newest non-archived saved plan where `data` matches the selected day.
5. Web calls `GET /api/dispatch/plans/:id` and renders route summary, stop count, assignment coverage, and current plan status.
6. Manager clicks `Zastosuj plan`; web calls `POST /api/dispatch/apply/:id`.
7. Harmonogram reloads tasks so the applied team/day assignments become visible in the manager panel.

## Contract

- Source of truth remains `dispatch_plans` and `/api/dispatch/*`.
- `Harmonogram` must not re-run the solver while loading a saved day plan.
- Missing plan for the selected day must be a visible, non-blocking message.
- Applying a plan must reuse `/dispatch/apply/:id`, including existing absent-team validation.
- The loaded plan preview must show at least: plan id, status, route count, stop count, assigned/total tasks, and first route summaries.

## GO

- `npm run verify:dispatcher-day-plan` passes.
- `npm test -w arbor-web -- Harmonogram.test.js` passes.
- A saved dispatcher plan can be loaded and applied from the schedule.

## NO-GO

- The schedule generates a new solver result instead of loading a saved one.
- The manager cannot see whether a plan is saved or applied.
- Applying the plan does not reload the schedule data.
