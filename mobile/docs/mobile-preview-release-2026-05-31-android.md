# Mobile Preview Release - Android - 2026-05-31

## Build

- Version: 1.0.0
- iOS build number: 1
- Android version code: 1
- EAS profile: preview
- Platform: Android
- EAS build URL: https://expo.dev/accounts/arboros/projects/arbor-mobile/builds/ab74ce21-f56a-48b1-9f22-5b19e3663d3c
- API environment: preview
- Expected API version: from `eas.json` preview profile
- Sentry status / DSN configured: runtime DSN supported; sourcemap auto-upload disabled for preview
- Commit / branch: local workspace
- Release owner: arboros
- Date: 2026-05-31

## Automated Gates

- [x] `npm run release:check` passed.
- [x] `npm run release:eas-doctor` passed on the release operator machine.
- [x] `npm run release:build:android:preview` completed.
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
- Notes: Install from the EAS build URL above, then complete `docs/mobile-device-smoke-checklist.md`.

## iOS Follow-Up

Preflight is available and passes EAS CLI/account/project checks:

```bash
npm run release:ios:preflight
```

iOS preview remains blocked until the release operator completes the interactive Apple/EAS credentials flow:

```bash
npm run release:ios:credentials
npm run release:build:ios:preview
```

## Install Helper

Run this from `mobile/` on the release/tester machine:

```bash
npm run install:android:preview
```

If `adb` is available and an Android device is connected, the helper confirms the device. If not, it prints the manual EAS install link and the exact fallback steps.

## Device QA Note Helper

Create a per-device QA note before testing:

```bash
npm run qa:note -- --tester=Jan --device=Pixel-8 --os=Android-15 --role=Brygadzista
```

The generated file lands in `docs/` and includes build metadata, required release checks, and a place to paste the Release QA summary from API Diagnostics.
