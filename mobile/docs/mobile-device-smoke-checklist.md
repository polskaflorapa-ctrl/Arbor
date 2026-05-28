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

- [ ] Install the latest build on a real iPhone.
- [ ] Confirm the build points to the intended API environment.
- [ ] Confirm app version/build number matches the release candidate.
- [ ] Start with a clean app install for one pass.
- [ ] Repeat once with an upgraded install over the previous build.

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
- [ ] Turn GPS live off.
- [ ] GPS status changes to disabled and the GPS banner disappears.
- [ ] Confirm no new `/mobile/me/location` requests are sent.
- [ ] Turn GPS live on.
- [ ] Status changes to ready/active after permission and location are available.
- [ ] Last sync time updates after a successful location send.
- [ ] Revoke location permission in iOS Settings and reopen app.
- [ ] GPS status shows missing permission / blocked state.

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

## Finish Task

- [ ] Complete required before/after photos on a test task.
- [ ] Open finish modal.
- [ ] Validate required payment/client/material/problem fields.
- [ ] Submit finish.
- [ ] Confirm task status and settlement data update after refresh.

## Notifications And Deep Links

- [ ] Register push token after login.
- [ ] Send a test notification to the device.
- [ ] Tap notification while app is foreground/background.
- [ ] App opens the expected screen.
- [ ] Old notification tap does not navigate to stale context.

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
- [ ] QA notes include device model, iOS version, build number, account role, API URL, and tester name.
