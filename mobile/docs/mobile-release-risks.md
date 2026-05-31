# Mobile Release Risks

Use this file while deciding whether a build can go to internal preview, TestFlight, or production.

## Production Blockers

- Real iPhone QA has not been completed for the exact build number.
- Push notification registration and deep link routing have not been confirmed on a physical device.
- GPS live tracking has not been checked with permission grant, permission denial, and permission revocation.
- Camera/gallery capture and upload have not been checked on a physical device.
- Offline queue replay has not been checked against the intended backend environment.
- Full offline field flow has not passed `docs/mobile-offline-field-flow-checklist.md` on a real device.
- Crash/error monitoring destination has not been confirmed for production. Sentry support is wired behind `EXPO_PUBLIC_SENTRY_DSN`; the local API Diagnostics fallback helps preview QA, but it is not a production monitoring destination.

## Internal Preview Blockers

- `npm run release:check` fails.
- Expo public config does not resolve.
- The build points to the wrong API environment.
- Login/session restore fails for a field worker account.
- The task detail flow crashes or blocks finishing a test task.
- Cached task list/detail or pending offline field actions do not survive app restart.
- Any high or critical production dependency advisory appears in `npm audit --omit=dev --audit-level=high`.

## Accepted For Internal Preview

- Moderate npm audit findings currently come from the Expo SDK dependency tree. npm recommends a breaking Expo SDK upgrade for the main fixes, so this is tracked as a separate upgrade task instead of being forced into a release candidate.
- Large task detail screen remains a refactor target, but current release readiness depends on typecheck, lint, and device QA rather than completing that refactor first.
- EAS CLI authentication and cloud build credentials must be completed in the release operator environment.
- Local crash/error report fallback is acceptable for internal preview if the API Diagnostics copy/clear flow passes on a real device.

## Follow-Up Work

- Plan Expo SDK upgrade in a dedicated branch and run full device QA afterward.
- Set production Sentry DSN/auth token and verify sourcemap upload before production, or replace Sentry with another approved crash reporting destination.
- Split the task detail screen into smaller tested components after release readiness is stable.
- Add backend-authenticated API smoke coverage to the release gate when a safe CI token is available.
