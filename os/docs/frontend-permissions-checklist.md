# Frontend Permissions Checklist

This checklist describes how UI should consume backend auth permission policy.

## Source of truth

- On login, read `user.permissions` from `POST /api/auth/login`.
- On app refresh / token restore, read `permissions` from:
  - `GET /api/auth/me`, or
  - `GET /api/auth/permissions` (recommended lightweight refresh flow).

## Contract fields

- `policyVersion`
- `taskScope`: `all | branch | assigned_team_only`
- `canViewPayrollSettlements`
- `canManagePayrollSettlements`
- `canViewSettlementModule`
- `canCreateTasks`
- `canAssignTeams`
- `canManageTeams`

## UI gating rules

- **Hide payroll module** when `canViewSettlementModule === false`.
- **Hide payout/settlement actions** when:
  - `canViewPayrollSettlements === false` (read),
  - `canManagePayrollSettlements === false` (write/edit/approve).
- **Hide create task UI** when `canCreateTasks === false`.
- **Hide team assignment actions** when `canAssignTeams === false`.
- **Hide team management screens/actions** when `canManageTeams === false`.

## Task list behavior

- If `taskScope === "all"`: show global filters/views.
- If `taskScope === "branch"`: show branch-scoped views only.
- If `taskScope === "assigned_team_only"`:
  - default to "My team tasks",
  - hide filters/views that imply cross-team visibility.

Backend already enforces restrictions, but UI should not expose blocked workflows.

## Error handling (required)

- For `401`: force re-auth flow.
- For `403`: show "Brak uprawnien" style message and redirect to allowed module.
- Always surface `requestId` in error toast/details for support/debug.

## Caching recommendations

- Cache permissions in auth store with token lifecycle.
- Refresh permissions:
  - after login,
  - after token refresh/reopen app,
  - after role/profile change event (if implemented).
- If `policyVersion` changes, invalidate cached permission shape and refresh.
