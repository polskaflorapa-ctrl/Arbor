# Mobile Preview Release - Android - 2026-06-02

## Build

- Version: 1.0.0
- iOS build number: 1
- Android version code: 1
- EAS profile: preview
- Platform: Android
- EAS build URL: https://expo.dev/accounts/arboros/projects/arbor-mobile/builds/fbfcac3c-bf86-404a-a5c0-0fd7ce7f134e
- APK artifact: `dist/arbor-mobile-1.0.0-preview-android-2026-06-02.apk`
- ZIP package: `dist/arbor-mobile-1.0.0-preview-android-2026-06-02.zip`
- APK SHA256: `079A0AFB9CAFEBA390B81D7355A833C3A8C0EE7A45D7FE31F1CDAE45AADB7433`
- API environment: preview
- Expected API version: from `eas.json` preview profile
- Sentry status / DSN configured: runtime DSN supported; sourcemap auto-upload disabled for preview
- Release owner: arboros
- Date: 2026-06-02

## Automated Gates

- [x] `npm run typecheck` passed.
- [x] `npm run lint` passed.
- [x] `npm run smoke:mobile` passed.
- [x] `npm run release:check` passed, including iOS and Android Metro bundles.
- [x] `npm run release:eas-doctor` passed with isolated EAS CLI.
- [x] `npm run release:build:android:preview` completed in EAS.
- [x] No high or critical production dependency advisories.
- [x] Known moderate Expo SDK advisories accepted for preview.

## Device QA Summary

- Device model:
- OS version:
- Tester:
- Test account role:
- Fresh install pass:
- Upgrade install pass:
- Checklist used: `docs/mobile-device-smoke-checklist.md`

## Required Result

- [ ] Login/session restore passed.
- [ ] Permissions prompts and denied-permission fallbacks passed.
- [ ] GPS live off/on, last sync, and blocked state passed.
- [ ] Task detail and status update flow passed.
- [ ] Camera/gallery upload and photo preview passed.
- [ ] Offline queue replay reached backend exactly once.
- [ ] Finish task validation and submit passed.
- [ ] Push notification deep link passed.
- [ ] Release QA summary from API Diagnostics pasted into notes.
- [ ] Local crash/error report fallback passed.
- [ ] Sentry status in API Diagnostics matches release intent.
- [ ] Privacy lock / Face ID passed.
- [ ] No redbox, uncaught exception, or stuck spinner observed.

## Known Issues

- Issue: iOS preview build is not created yet.
- Impact: Android can start field QA; iOS QA waits for Apple credentials.
- Workaround: run `npm run release:build:ios:preview` interactively after Apple credentials/provisioning are configured in EAS.
- Owner: release operator
- Decision: accept for Android preview / block iOS preview

## Go / No-Go

- Decision: Android preview ready for device QA.
- Approver:
- Notes: Install from the EAS build URL or local APK above, then complete `docs/mobile-device-smoke-checklist.md`.
