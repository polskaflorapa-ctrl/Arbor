# Mobile Store Readiness Checklist

Use this before TestFlight, App Store review, or Google Play internal testing.

## App Identity

- [ ] App display name is final.
- [ ] Bundle identifier is final: `com.arbor.mobile`.
- [ ] Android package is final: `com.arbor.mobile`.
- [ ] App icon and adaptive Android icon render correctly.
- [ ] Splash screen matches the current brand and is readable in light/dark mode.
- [x] Store metadata source exists: `mobile/config/store-metadata.json`.
- [x] Support URL is ready: `https://arbo-os.com/support.html`.
- [x] Marketing URL is ready: `https://arbo-os.com`.
- [x] Privacy policy URL is ready: `https://arbo-os.com/privacy.html`.
- [ ] Product owner and legal/privacy owner reviewed the privacy notice before public submission.

## Review Access

- [ ] Reviewer test account exists.
- [ ] Reviewer account has field worker permissions.
- [ ] Reviewer account has safe demo/test data.
- [x] Login instructions template is written in `mobile/config/store-metadata.json`.
- [ ] Reviewer-specific username/password are added to the store review notes at submission time.
- [x] Backend environment used for review is documented in `mobile/config/store-metadata.json`.
- [ ] Backend environment used for review will stay available during review.

## Permission Review Notes

- Camera: used for documenting jobs, inspections, protocols, and before/after photos.
- Photos: used for attaching site documentation, sketches, and materials to jobs.
- Location: used during work to show crew and estimator positions in the schedule.
- Face ID: used to unlock the app when privacy lock is enabled.
- Push notifications: used for operational job updates and deep links.

## Privacy Labels

- [ ] Location data is declared if sent to backend for live GPS.
- [ ] Photos/media are declared if uploaded as job evidence.
- [ ] User identifiers/account data are declared.
- [ ] Diagnostics/crash data are declared if crash reporting is enabled.
- [ ] Sentry or another crash destination is named in review/release notes if enabled.
- [ ] Data linked to user is reviewed with backend/API owner.
- [ ] Data retention and deletion process is documented.

## Screenshots And Metadata

- [ ] iPhone screenshots show real app workflows, not placeholder data.
- [ ] Screenshots include dashboard, task detail, evidence/photos, profile/privacy, and GPS state if appropriate.
- [ ] App subtitle and description describe field operations plainly.
- [ ] Keywords avoid unsupported claims.
- [ ] Version release notes mention user-visible changes and known preview limits.

## Submission Gates

- [ ] `npm run release:store-check` passed.
- [ ] `npm run release:check` passed.
- [ ] `npm run release:eas-doctor` passed.
- [ ] Preview build completed and was installed on a real iPhone.
- [ ] `docs/mobile-device-smoke-checklist.md` passed.
- [ ] API Diagnostics Release QA summary was copied into the preview release note.
- [ ] `docs/mobile-offline-field-flow-checklist.md` passed for the target backend environment.
- [ ] Crash/error reporting is covered by Sentry/another external destination for production, or the local API Diagnostics fallback was checked and accepted for preview only.
- [ ] `docs/mobile-preview-release-template.md` has a go decision.
- [ ] Production blockers in `docs/mobile-release-risks.md` are resolved or explicitly accepted by the owner.
