# Changelog

## v2.1.1 - 2026-04-19

- Added `/api/ready` endpoint for readiness checks with DB-aware `200/503` responses.
- Added automated readiness tests for ready and not-ready backend states.
- Expanded regression coverage for auth permissions contract consistency and task access scope policy.

## v2.1.0 - 2026-04-19

- Hardened backend runtime with split app/server bootstrap and graceful shutdown.
- Added request-scoped observability (`x-request-id`) and structured logger across routes.
- Introduced shared input validation (`body`, `params`, `query`) and stricter auth handling.
- Improved production config safety (`env` schema validation, CORS origin configuration, `.env.example`).
- Expanded automated verification with Jest/Supertest coverage and a PowerShell smoke script.