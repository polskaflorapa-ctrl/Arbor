# Mobile Device Smoke Checklist

Use this before every beta or field test build. Run the automated checks first:

```bash
npm run smoke:mobile
```

Optional backend smoke:

```bash
SMOKE_API=1 AUTH_TOKEN=... npm run smoke:mobile
```

## Device Setup

- [ ] Install the latest build on a real Android device or iPhone that matches the target preview build.
- [ ] Confirm the build points to the intended API environment.
- [ ] Confirm app version/build number matches the release candidate.
- [ ] Start with a clean app install for one pass.
- [ ] Repeat once with an upgraded install over the previous build.
- [ ] For Android preview, install from the EAS build URL or QR code in the preview release note.
- [ ] For iOS preview, confirm Apple credentials/provisioning are configured and the TestFlight/internal build is available.

## Login And Session

- [ ] Launch app while online.
- [ ] Log in with a field worker account.
- [ ] Close and reopen the app; session is still active.
- [ ] Log out from profile.
- [ ] Log in again; no stale user data is visible.

## Permissions

- [ ] Camera permission prompt text is clear.
- [ ] Photo library permission prompt text is clear.
- [ ] Location permission prompt text is clear.
- [ ] Face ID prompt text is clear when privacy lock is enabled.
- [ ] Denying a permission gives a usable in-app fallback.

## GPS Live

- [ ] Open Profile.
- [ ] GPS live switch is visible for field roles.
- [ ] Confirm Profile explains GPS works only while the app is foreground/active, not 24/7 in background.
- [ ] Turn GPS live off.
- [ ] GPS status changes to disabled and the GPS banner disappears.
- [ ] Confirm no new `/mobile/me/location` requests are sent.
- [ ] Turn GPS live on.
- [ ] Status changes to ready/active after permission and location are available.
- [ ] Last sync time updates after a successful location send.
- [ ] Put app in background; confirm no foreground heartbeat continues from the app.
- [ ] Reopen app; status returns to ready/active after permission and location are available.
- [ ] Deny location permission on a fresh install; Profile shows missing permission / blocked guidance.
- [ ] Revoke location permission in iOS Settings and reopen app.
- [ ] GPS status shows revoked permission / blocked state and tells the tester to enable location in system settings.
- [ ] Disable network while GPS permission remains granted; status shows offline/sync warning without crashing.

## Task Flow

- [ ] Open Dashboard.
- [ ] Open the active task list.
- [ ] Open a task detail screen.
- [ ] Task details, address, crew, planned date, and status render correctly.
- [ ] Change a safe status in a test task.
- [ ] Pull to refresh and confirm the change persists.

## Photos And Evidence

- [ ] Add a photo from camera.
- [ ] Add a photo from gallery.
- [ ] Open photo preview.
- [ ] Photo type label, timestamp, tags, and GPS metadata render correctly.
- [ ] Upload failure shows a clear message.

## Offline Queue

- [ ] Turn on airplane mode.
- [ ] Perform an action that supports offline queue.
- [ ] Confirm app shows the offline queued message.
- [ ] Return online.
- [ ] Confirm offline sync banner appears.
- [ ] Confirm action reaches backend exactly once.
- [ ] Confirm duplicate retry does not duplicate server state.
- [ ] Run the full offline field flow checklist in `docs/mobile-offline-field-flow-checklist.md`.
- [ ] Confirm cached list, cached task detail, pending photos, pending problems, check-in, START, and finish survive app restart while offline.

## Finish Task

- [ ] Complete required before/after photos on a test task.
- [ ] Open finish modal.
- [ ] Validate required payment/client/material/problem fields.
- [ ] Submit finish.
- [ ] Confirm task status and settlement data update after refresh.

## Notifications And Deep Links

- [ ] Register push token after login.
- [ ] Send a test notification to the device.
- [ ] Send a test notification with payload `{ "taskId": <today_test_task_id> }`.
- [ ] Tap notification while app is foreground/background.
- [ ] App opens `/zlecenie/<today_test_task_id>`.
- [ ] Send a test notification with payload `{ "task_id": <today_test_task_id>, "tab": "problemy" }`.
- [ ] App opens the task detail problem tab.
- [ ] Send a test notification with payload `{ "path": "/harmonogram" }`.
- [ ] App opens the expected screen.
- [ ] Send a test notification without route/task payload.
- [ ] App falls back to `/powiadomienia`.
- [ ] Old notification tap does not navigate to stale context.

## Crash/Error Report Fallback

- [ ] Open API Diagnostics.
- [ ] Confirm Release QA section is visible and copy button exports the summary into QA notes.
- [ ] Confirm Release QA shows expected states for session, API, API version, offline queue, Sentry, GPS live, and app errors.
- [ ] Confirm the Monitoring bledow section is visible.
- [ ] Confirm Sentry status matches the build intent: `wlaczone` for Sentry-enabled builds or `brak DSN` for local fallback preview.
- [ ] If no report exists, tap Zapisz testowy raport.
- [ ] Confirm the report shows time, source, error message, and stack preview.
- [ ] Tap Kopiuj raport bledu and paste it into QA notes.
- [ ] Tap Wyczysc and confirm the section returns to no-report state.
- [ ] If a real crash/error happened, copy the local report before reinstalling the app.

## Privacy Lock

- [ ] Enable privacy lock in Profile.
- [ ] Background the app.
- [ ] Reopen app.
- [ ] Face ID unlock appears.
- [ ] Cancel keeps the app locked.
- [ ] Successful Face ID unlock resumes the current screen.

## Final Pass

- [ ] No redbox or uncaught exception occurred.
- [ ] No stuck spinner after network loss/recovery.
- [ ] No unreadable/mojibake text is visible in key flows.
- [ ] Battery drain feels acceptable during a 20 minute field simulation.
- [ ] QA notes include device model, OS version, build number, account role, API URL, and tester name.
