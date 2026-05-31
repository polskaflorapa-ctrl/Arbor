# Mobile Preview Release Template

Copy this section into the release note for every internal preview build.

## Build

- Version:
- iOS build number:
- Android version code:
- EAS profile:
- Platform:
- EAS build URL:
- API environment:
- Expected API version:
- Sentry status / DSN configured:
- Commit / branch:
- Release owner:
- Date:

## Automated Gates

- [ ] `npm run release:check` passed.
- [ ] `npm run release:eas-doctor` passed on the release operator machine.
- [ ] `npm run release:build:ios:preview` or Android equivalent completed.
- [ ] No high or critical production dependency advisories.
- [ ] Known moderate Expo SDK advisories accepted for preview.

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

- Issue:
- Impact:
- Workaround:
- Owner:
- Decision: accept for preview / block preview / block production

## Go / No-Go

- Decision:
- Approver:
- Notes:
