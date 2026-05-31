# Mobile Offline Field Flow Checklist

Use this on a real device before internal preview or field pilot builds. Run automated checks first:

```bash
npm run test:offline-queue
npm run typecheck
npm run lint
```

Record device model, OS version, build number, account role, API URL, and tester name in release notes.

## Test Data

- [ ] Use a field worker account assigned to a test crew.
- [ ] Use a test task scheduled for today.
- [ ] Task has address, scope, crew, planned time, and required equipment.
- [ ] Task has required before/after photo policy enabled for the branch, if testing production-like finish rules.
- [ ] Task can be safely finished without affecting real customer or payroll data.

## Warm Cache Online

- [ ] Launch the app online.
- [ ] Open `Zlecenia`.
- [ ] Confirm today's task appears.
- [ ] Open task detail.
- [ ] Confirm task info, logs, problems, photos, and CMR section load.
- [ ] Return to `Misja dnia`; confirm today's route is visible.

## Offline List And Detail

- [ ] Turn on airplane mode.
- [ ] Kill and relaunch the app.
- [ ] Open `Zlecenia`.
- [ ] Confirm today's cached tasks appear with an offline/cache notice.
- [ ] Open the cached task detail.
- [ ] Confirm task details render without a stuck spinner.
- [ ] Confirm logs, problems, and photos from cache render.

## Offline Evidence

- [ ] Add a `Przed praca` photo.
- [ ] Confirm the photo appears immediately in the gallery.
- [ ] Confirm the photo has `czeka na sync` / pending marker.
- [ ] Close and reopen the task detail while still offline.
- [ ] Confirm the pending photo is still visible from cache.

## Offline Problem

- [ ] Open `Problemy`.
- [ ] Add a problem with a clear description.
- [ ] Confirm the problem appears immediately with `Czeka na sync`.
- [ ] Add a problem photo.
- [ ] Confirm the problem photo appears immediately in the photo gallery with pending marker.
- [ ] Close and reopen the task detail while still offline.
- [ ] Confirm the pending problem is still visible from cache.

## Offline Check-In And Start

- [ ] Tap `Dojechalismy` / check-in.
- [ ] Confirm a local check-in log appears with pending sync message.
- [ ] Tap `START`.
- [ ] Confirm task locally shows work in progress.
- [ ] Confirm a local START log appears with pending sync message.
- [ ] Close and reopen the task detail while still offline.
- [ ] Confirm check-in and START pending state is still visible.

## Offline Finish

- [ ] Add required `Po pracy` photo.
- [ ] Complete client acceptance/signature requirement.
- [ ] Confirm open problems are resolved or marked as handed to office.
- [ ] Complete payment/material/operational cost fields required for the test branch.
- [ ] Tap `Zamknij zlecenie`.
- [ ] Confirm task locally shows the field work as closed.
- [ ] Confirm active work log has a local end time or a finish pending log exists.
- [ ] Confirm `Finish czeka na synchronizacje` is visible in logs.
- [ ] Close and reopen the task detail while still offline.
- [ ] Confirm finish pending state is still visible from cache.

## Sync Recovery

- [ ] Turn airplane mode off.
- [ ] Wait for offline sync or trigger refresh.
- [ ] Confirm offline queue count decreases to zero.
- [ ] Pull to refresh task detail.
- [ ] Confirm pending markers are replaced by backend data.
- [ ] Confirm backend has exactly one photo per queued photo action.
- [ ] Confirm backend has exactly one problem per queued problem action.
- [ ] Confirm backend has exactly one check-in/start/finish effect.
- [ ] Confirm task is finished and settlement/payment/material data is visible where expected.

## Failure Recovery

- [ ] Repeat one pass with API returning 5xx for at least one queued action.
- [ ] Confirm pending markers stay visible.
- [ ] Confirm retry status/error is visible in diagnostics or queue banner.
- [ ] Restore API.
- [ ] Confirm retry eventually succeeds without duplicate backend state.

## Exit Criteria

- [ ] No redbox or uncaught exception.
- [ ] No stuck spinner after network loss or recovery.
- [ ] No duplicate backend records after retry.
- [ ] Pending local state survives app restart.
- [ ] Backend state wins after successful sync.
- [ ] QA notes include any mismatch between local pending state and backend final state.
