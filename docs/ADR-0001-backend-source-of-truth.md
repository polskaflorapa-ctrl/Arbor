# ADR-0001: Backend Source Of Truth

Status: accepted
Date: 2026-05-25

## Decision

`os/` is the production backend and the only source of truth for API behavior,
database migrations, authorization rules, integrations, and operational smoke
checks.

`web/server/` may remain as a local demo/mock server, but it must not define
production-only behavior. Any endpoint needed by web or mobile in real
operation belongs in `os/`.

## Consequences

- Database schema changes go through `os/migrate.sql`.
- Production API documentation lives in `os/docs/openapi.yaml`.
- Web and mobile clients should be validated against `os/` routes.
- `web/server/` changes are acceptable only for local demo parity or tests.
- Deploy docs should point production traffic at `arbor-os`.

## Verification

Use the full local gate before handing off a larger change:

```powershell
npm run check:full
```

For production/staging smoke checks with a running API:

```powershell
npm run deploy:free:check -- https://<arbor-os-url>
npm run smoke:render -- https://<arbor-os-url>
```
