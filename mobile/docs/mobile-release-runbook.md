# Mobile Release Runbook

This runbook is for Arbor Mobile Expo/EAS release candidates.

## 1. Before Building

Run the local release gate:

```bash
npm run release:check
```

Check the EAS operator environment before cloud builds:

```bash
npm run release:eas-doctor
```

Optional backend smoke:

```bash
SMOKE_API=1 AUTH_TOKEN=... npm run smoke:mobile
```

`release:check` verifies release metadata, EAS profiles, release docs, Expo public config generation, typecheck, lint, offline queue tests, and high/critical production dependency advisories. `release:eas-doctor` verifies that the current shell can run EAS, is logged in, and can access the Expo project.

Check release metadata:

- [ ] `app.json` version is correct.
- [ ] `ios.buildNumber` is incremented for iOS releases.
- [ ] `android.versionCode` is incremented for Android releases.
- [ ] `EXPO_PUBLIC_API_URL` points to the intended backend.
- [ ] `EXPO_PUBLIC_EXPECTED_API_VERSION` matches the backend release note or is intentionally left as profile default.
- [ ] `npm run release:eas-doctor` passes on the release operator machine.

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

Example commands:

```bash
npx eas build --platform ios --profile development
npx eas build --platform ios --profile preview
npx eas build --platform ios --profile production
```

For Android:

```bash
npx eas build --platform android --profile preview
npx eas build --platform android --profile production
```

## 3. Device QA

Install the build on a real iPhone and run:

- `docs/mobile-device-smoke-checklist.md`

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
- [ ] Known issues are documented in `docs/mobile-release-risks.md` or the release note.
- [ ] `npm audit --omit=dev` output is reviewed; any Expo SDK major-upgrade findings are accepted or handled in a dedicated SDK upgrade branch.
- [ ] API URL and build profile are confirmed.
- [ ] Crash/error monitoring destination is confirmed.
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
