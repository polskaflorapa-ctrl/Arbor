# Mobile Release Runbook

This runbook is for Arbor Mobile Expo/EAS release candidates.

## 1. Before Building

Run the local release gate:

```bash
npm run release:check
```

For a faster local sanity check while iterating, use:

```bash
npm run release:check:quick
```

Check the EAS operator environment before cloud builds:

```bash
npm run release:eas-doctor
```

If it reports that the shell is not logged in, authenticate with the same pinned CLI version:

```bash
npm exec --yes --package eas-cli@19.1.0 -- eas login
```

Optional backend smoke:

```bash
SMOKE_API=1 AUTH_TOKEN=... npm run smoke:mobile
```

`release:check` verifies release metadata, EAS profiles, release docs, Expo public config generation, typecheck, lint, offline queue tests, Metro iOS/Android bundle resolution, and high/critical production dependency advisories. `release:check:quick` runs the same gate but skips the slow Metro export. `release:eas-doctor` verifies that the current shell can run EAS, is logged in, and can access the Expo project.

Check release metadata:

- [ ] `app.json` version is correct.
- [ ] `ios.buildNumber` is incremented for iOS releases.
- [ ] `android.versionCode` is incremented for Android releases.
- [ ] `eas.json` profile `EXPO_PUBLIC_API_URL` points to the intended backend.
- [ ] `eas.json` profile `EXPO_PUBLIC_EXPECTED_API_VERSION` matches the backend release note or is intentionally left as profile default.
- [ ] `config/release-environments.json` contains only `development`, `preview`, and `production`, with `apiUrl`, `expectedApiVersion`, and `purpose` filled in.
- [ ] `npm run release:eas-doctor` passes on the release operator machine.

Crash/error monitoring:

- [ ] `EXPO_PUBLIC_SENTRY_DSN` is set for production builds, or the owner explicitly accepts local-only crash fallback for preview.
- [ ] `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are set in the EAS build environment before production if Sentry sourcemaps should be uploaded.
- [ ] EAS project is linked to the matching Sentry project, or the Sentry organization/project are configured in the Sentry workflow.
- [ ] API Diagnostics shows `Sentry: wlaczone (...)` in the target build.

Security dependency check:

```bash
npm audit --omit=dev
```

Current note: the known moderate audit findings in the Expo dependency tree require an Expo SDK major upgrade according to npm (`expo` / `expo-constants` / related packages). Do not run `npm audit fix --force` during a release candidate unless the release is explicitly an Expo SDK upgrade. Track this as a separate upgrade task and run full device QA after the SDK bump.

## 2. Build Profiles

Use `eas.json` profiles:

- `development`: internal dev-client build for debugging native behavior.
- `preview`: internal QA build for field testing.
- `production`: store-ready build with EAS auto-increment enabled.

Environment intent is tracked in `config/release-environments.json`; keep it in sync with `eas.json`.

Use the guarded build commands. They run `release:check`, `release:eas-doctor`, and then the EAS build:

```bash
npm run release:build:ios:preview
npm run release:build:ios:production
```

For Android:

```bash
npm run release:build:android:preview
npm run release:build:android:production
```

For a dev-client build, run the wrapper directly:

```bash
node ./scripts/eas-release-build.cjs ios development
```

## 3. Device QA

Install the build on a real iPhone and run:

- `docs/mobile-device-smoke-checklist.md`

Record the build result and QA decision in:

- `docs/mobile-preview-release-template.md`

Before TestFlight, App Store review, or Google Play internal testing, complete:

- `docs/mobile-store-readiness-checklist.md`

Do not promote the build if any of these fail:

- login/session restore
- GPS live off/on and status
- camera/gallery upload
- offline queue replay
- task finish flow
- push notification deep link
- privacy lock / Face ID

## 4. Production Promotion

Before submit:

- [ ] `npm run release:check` is green.
- [ ] `npm run release:eas-doctor` is green on the release operator machine.
- [ ] Device QA checklist is complete.
- [ ] Store readiness checklist is complete.
- [ ] Known issues are documented in `docs/mobile-release-risks.md` or the release note.
- [ ] Preview QA result is recorded from `docs/mobile-preview-release-template.md`.
- [ ] `npm audit --omit=dev` output is reviewed; any Expo SDK major-upgrade findings are accepted or handled in a dedicated SDK upgrade branch.
- [ ] API URL and build profile are confirmed.
- [ ] Crash/error monitoring destination is confirmed.
- [ ] Sentry DSN, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are confirmed for production, if Sentry is the selected destination.
- [ ] Rollback plan is written in the release note.

Submit when ready:

```bash
npx eas submit --platform ios --profile production
```

## 5. Rollback Notes

For internal builds, publish the previous known-good build link to testers.

For store builds, prepare:

- previous build number/version
- impacted roles
- affected API version
- exact rollback communication for field crews
