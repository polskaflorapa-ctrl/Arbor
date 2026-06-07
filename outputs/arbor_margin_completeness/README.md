# ARBOR Margin Completeness

Created: 2026-06-06

## What this checks

This pack validates whether ARBOR margin reporting is decision-ready or overstated by missing cost lanes.

The SQL creates a temporary table and returns:

- branch-level margin health,
- task-level cleanup queue,
- missing settlement, operational cost, material, and labor-cost flags,
- a margin confidence label per task.

## Local snapshot sanity check

Source checked: `web/server/data/state.json`

- Tasks: 7
- Status mix: 4 `W_Realizacji`, 2 `Zakonczone`, 1 `Nowa`
- Branch mix: 3 tasks in branch `1`, 4 tasks in branch `2`
- Scheduled tasks: 7
- Completed or execution-dated tasks: 5
- Planned revenue sum: 29,500
- Actual or settlement revenue sum found in snapshot fields: 0
- Cost/margin-related task fields found: `wartosc_planowana`, `wartosc_szacowana`

Interpretation: the local JSON snapshot is useful for workflow shape, but it is not enough to validate real margin. It has planned values, but not the settlement and cost detail needed for margin.

## Local database status

The app environment loads successfully and has DB credentials configured, but PostgreSQL was not reachable on `localhost:5432`.

Docker startup was attempted via `npm run db:up` in `os/`, but Docker Desktop returned a 500 error while resolving `postgres:16-alpine`.

## How to run

Run `arbor_margin_completeness.sql` in a PostgreSQL session connected to staging or production.

The script uses a 90-day lookback by default. To scope to one branch, edit the `params` CTE:

```sql
SELECT
  90::int AS lookback_days,
  1::int AS only_branch_id
```

The query only creates `tmp_arbor_margin_completeness`, a temporary table for the current database session.

## Schema note

`task_operational_costs` uses `category` and `amount`, matching `os/migrate.sql` and the finish-flow services.
