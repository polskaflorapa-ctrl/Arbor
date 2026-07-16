# Arbor OS Backend Contract

This folder is the implementation contract for the production backend. A runnable backend lives in `server/index.mjs`; it uses the same endpoints with a relational SQLite store in `server/data/arbor-os.sqlite`.

## Auth

- `POST /api/auth/login` -> `{ token, user }`
- Tokens are HMAC-signed and expire. Claims: `sub`, `role`, `branchId`, `teamId`, `iat`, `exp`.
- All non-public API routes require `Authorization: Bearer <token>` and return `401` when missing or invalid.
- Inactive or archived users cannot log in and cannot authenticate REST/WebSocket sessions.
- Every REST handler and WebSocket subscription must call the same RBAC matrix as `src/lib/rbac.ts`.

## Core REST

- `GET /api/orders`
- `GET /api/branches`
- `POST /api/branches`
- `PATCH /api/branches/:id`
- `DELETE /api/branches/:id`
- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`
- `DELETE /api/users/:id`
- `PATCH /api/users/:id/password`
- `GET /api/role-permissions`
- `PATCH /api/role-permissions/:role`
- `POST /api/role-permissions/:role/reset`
- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `POST /api/orders`
- `PATCH /api/orders/:id`
- `DELETE /api/orders/:id`
- `PATCH /api/orders/:id/status`
- `POST /api/orders/:id/assign-team`
- `GET /api/valuations`
- `POST /api/valuations`
- `PATCH /api/valuations/:id`
- `PATCH /api/valuations/:id/status`
- `DELETE /api/valuations/:id`
- `GET /api/invoices`
- `POST /api/invoices`
- `PATCH /api/invoices/:id`
- `PATCH /api/invoices/:id/status`
- `DELETE /api/invoices/:id`
- `POST /api/documents/generate`
- `POST /api/documents/attach`
- `POST /api/generated-documents/:id/sign`
- `GET /api/documents/compliance`
- `GET /api/document-templates`
- `POST /api/document-templates`
- `PATCH /api/document-templates/:id`
- `DELETE /api/document-templates/:id`
- `POST /api/document-templates/:id/preview`
- `GET /api/document-requirements`
- `POST /api/document-requirements`
- `PATCH /api/document-requirements/:id`
- `DELETE /api/document-requirements/:id`
- `GET /api/job-positions`
- `POST /api/job-positions`
- `PATCH /api/job-positions/:id`
- `DELETE /api/job-positions/:id`
- `GET /api/hr/contracts`
- `POST /api/hr/contracts`
- `PATCH /api/hr/contracts/:id`
- `DELETE /api/hr/contracts/:id`
- `GET /api/hr/trainings`
- `POST /api/hr/trainings`
- `PATCH /api/hr/trainings/:id`
- `DELETE /api/hr/trainings/:id`
- `GET /api/hr/medical-exams`
- `POST /api/hr/medical-exams`
- `PATCH /api/hr/medical-exams/:id`
- `DELETE /api/hr/medical-exams/:id`
- `GET /api/hr/certifications`
- `POST /api/hr/certifications`
- `PATCH /api/hr/certifications/:id`
- `DELETE /api/hr/certifications/:id`
- `GET /api/hr/compliance`
- `GET /api/module-configs`
- `POST /api/module-configs`
- `PATCH /api/module-configs/:id`
- `DELETE /api/module-configs/:id`
- `GET /api/ai-prompts`
- `POST /api/ai-prompts`
- `PATCH /api/ai-prompts/:id`
- `DELETE /api/ai-prompts/:id`
- `GET /api/ai-prompts/:id/versions`
- `POST /api/ai-prompts/:id/test`
- `POST /api/ai-prompts/:id/rollback`
- `GET /api/workflows`
- `POST /api/workflows`
- `PATCH /api/workflows/:id`
- `DELETE /api/workflows/:id`
- `GET /api/workflow-runs`
- `GET /api/clients`
- `POST /api/clients`
- `PATCH /api/clients/:id`
- `DELETE /api/clients/:id`

Client create/update accepts `pipelineStage` for the CRM kanban pipeline. Allowed values: `lead`, `kontakt`, `oferta`, `negocjacje`, `wygrane`. The value is tenant-scoped with the client, persisted in SQLite, included in CSV import/export, and returned by bootstrap/client list responses so web clients can persist drag/move actions across refreshes.
- `GET /api/communications`
- `POST /api/communications`
- `PATCH /api/communications/:id`
- `DELETE /api/communications/:id`
- `GET /api/crews`
- `POST /api/crews`
- `PATCH /api/crews/:id`
- `DELETE /api/crews/:id`
- `GET /api/equipment`
- `POST /api/equipment`
- `PATCH /api/equipment/:id`
- `DELETE /api/equipment/:id`
- `GET /api/equipment-reservations`
- `POST /api/equipment/:id/reservations`
- `PATCH /api/equipment-reservations/:id`
- `DELETE /api/equipment-reservations/:id`
- `GET /api/warehouse`
- `POST /api/warehouse/items`
- `PATCH /api/warehouse/items/:id`
- `DELETE /api/warehouse/items/:id`
- `POST /api/warehouse/movements`
- `GET /api/tree-assets?clientId=&orderId=&valuationId=`
- `POST /api/tree-assets`
- `PATCH /api/tree-assets/:id`
- `DELETE /api/tree-assets/:id`
- `GET /api/sync?since=:lastEventId`
- `POST /api/sync/mutations`

Implemented mutations are role-gated on the server. `POST /api/orders` is the office intake entry point for a phone/web lead. It creates an order in `NOWE`, assigns the branch/client scope, adds a first timeline row, and publishes `order.created` to `branch:{id}:orders`.

Branches are tenant-scoped through `/api/branches`. Settings administrators can add, edit, list active branches, include archived branches with `?includeArchived=true`, and delete/archive branches. Branches with no references are removed; branches with history are archived; branches with active users, the caller's own active branch, or the last active tenant branch are protected. Archived branches stay in tenant scope for historical records but are hidden from bootstrap active branches and cannot be used for new writes.

Users are tenant/branch scoped through `/api/users`. Settings administrators can create staff accounts with a start password/PIN, edit name, login, role, branch, team, and active/inactive status, change passwords, and archive accounts. `passwordHash` is never returned. Active lists hide inactive/archived users by default, `?includeInactive=true` includes inactive users for administration, archived users stay hidden, and the backend blocks self-deactivation, self-deletion, self-demotion from administrator, and removal of the last active tenant administrator.

Role permissions are tenant-scoped through `/api/role-permissions`. Administrators can list effective permissions for every role, edit readable/writable modules for non-system roles, and reset a role to the platform default. `ADMINISTRATOR` remains system-locked so a tenant cannot lose access to settings. Backend `requireAccess`, bootstrap payloads, and realtime channel authorization all use the effective tenant role profile, not only the static defaults.

Valuations are editable through `/api/valuations`. Creating/upserting validates the order, estimator, status, inspection date, totals, margin, media, and line items. Each order has one active valuation; archived valuations are hidden from active lists and reports, and a later upsert reactivates the order's valuation row instead of violating the SQLite `orderId` uniqueness rule.

Tree inventory is editable through `/api/tree-assets`. Each tree is tenant-scoped and can be linked to a client, order, and valuation with species, common name, condition, risk level, GPS, photos, notes, and work recommendation. Tree records appear in the client 360 timeline, update the related order timeline, publish `tree_asset.*` audit/realtime events, and are hidden from active lists after archive.

Communications are editable through `/api/communications`. Manual notes, calls, meetings, SMS, and e-mail records validate client/order tenant scope, assignee scope, channel/status enums, transcripts, recordings, and AI analysis metadata. Deleting a communication archives it with audit fields so recordings/transcripts stay traceable while active CRM timelines stay clean.

When an order reaches `ZAKONCZONE`, the backend automatically creates one draft invoice for that order if none exists yet and publishes `invoice.created` on the `invoices` realtime channel. Accounting/office users can also create an invoice explicitly with `POST /api/invoices`.

Generated documents can be signed only after they are `ready` and have no missing template fields. Signing writes immutable signature metadata (`signedAt`, `signedBy`, signer name/e-mail, method, hash), appends the subject timeline when applicable, emits `document.signed`, and keeps workflow rollback from deleting the signed document.

Manual document repository uploads use `POST /api/documents/attach` with `subjectType`, `subjectId`, and one of `fileName`, `fileUrl`, or `content`. Optional `requirementId`, `expiresAt`, and `status: "signed"` let uploaded medical exams, BHP documents, equipment OC, protocols, and customer files satisfy compliance without requiring a generated template first.

Document templates are tenant-editable through `/api/document-templates`. Global seed templates are readable base templates; create a tenant copy with `basedOnTemplateId`, then edit, preview, or delete that copy. Deleting a template used by generated documents archives it instead of breaking document history.

Crews are tenant/branch scoped through `/api/crews`. Creating and editing validates branch access, leader tenant scope, duplicate names per branch, member lists, and utilization `0-100`. Deleting an unused crew removes it; deleting a crew referenced by orders or users archives it so history and assignments remain auditable while active lists stay clean.

HR compliance records are editable through `/api/hr/trainings`, `/api/hr/medical-exams`, and `/api/hr/certifications`. Each mutation validates employee tenant/branch access, date ordering, and required fields, recalculates `valid`/`due_soon`/`expired` status from the expiry date, emits an audit/realtime event, and archives records on delete so compliance history remains traceable while active reports stay clean.

Document requirements are also tenant-editable through `/api/document-requirements`. They define required documents for employees, equipment, orders, or company-level compliance. Deleting a requirement used by generated/attached documents archives it instead of breaking audit history.

HR contract automation uses `/api/hr/contracts` with `employeeId` and `positionId`. The backend lists active contracts, creates or updates an employee contract from the job position defaults, can generate a contract document from the active employee contract template, links it to the employee, returns the employee compliance report, and archives deleted contracts so HR audit history remains traceable while active compliance reports stay clean.

Job positions are tenant-scoped when created through `POST /api/job-positions`. Required documents and training are editable per position, and required document names can automatically create employee `DocumentRequirement` rows for compliance. Built-in global seed positions are readable templates; mutate a tenant copy instead of editing or deleting the global base row. Deleting an unused tenant position removes it and its unused generated requirements; deleting a position referenced by active contracts archives it and cleans linked requirements without breaking historical contracts.

Module configurations are tenant-scoped through `/api/module-configs`. Administrators can add, edit, and archive per-module labels, enabled state, statuses, required documents, and custom fields. A tenant can have one active configuration per module, and archived configurations are hidden from bootstrap while keeping audit metadata.

AI prompts are tenant-scoped through `/api/ai-prompts`. Administrators can add prompts for office calls, estimator calls, field meetings, complaints, follow-ups, and the AI receptionist, update name/kind/status/body, test a prompt on sample transcripts, inspect versions, and roll back to an earlier version. Deleting an unused prompt removes it with its versions; deleting a prompt used by call/meeting analyses archives it so historical analyses keep their prompt reference while new analyses only use active prompts.

Workflows are tenant-scoped through `/api/workflows`. Administrators can list, create, edit, test, pause, kill-switch, execute, approve/reject, roll back, and delete workflow definitions. Deleting an unused workflow removes it; deleting a workflow with run/task/message/document history archives it, enables its kill switch, hides it from active lists, and keeps workflow runs available through `/api/workflow-runs` for audit.

Fleet equipment supports tenant/branch-safe create, edit, and delete through `/api/equipment`. Reservations are managed through `/api/equipment-reservations` and validate equipment scope, order scope, matching branch, date ordering, conflicts, and status. Editing a reservation recalculates equipment availability; cancelling a reservation preserves audit history and frees equipment only when no other active reservations remain. Deleting unused equipment removes it from the active dataset; equipment with reservation or document history is archived instead. Equipment with an active reservation cannot be deleted until the reservation is cancelled.

Warehouse items support tenant/branch-safe create, edit, movement, and delete through `/api/warehouse`. Deleting unused items removes them; items with stock movement history are archived so inventory audit history remains intact.

Tasks support create, edit, completion, and delete through `/api/tasks`. Deleting a task marks it cancelled with `deletedAt/deletedBy` and hides it from active task lists while preserving audit and workflow references.

Clients and orders are active-list safe. `DELETE /api/clients/:id` removes an unused client or archives a client that already has orders, calls, tasks, documents, invoices, AI sessions, or valuations. `DELETE /api/orders/:id` marks the order as `ANULOWANE`, stores `deletedAt/deletedBy`, and hides it from active order lists while keeping operational history.

Invoices support full edit and audit-safe archive through `/api/invoices`. Archived invoices keep number, payment, and audit metadata but are hidden from active invoice lists and revenue reports.

## Realtime Channels

- `branch:{id}:orders`
- `team:{id}`
- `valuations`
- `gps:{branch}`
- `invoices`
- `announcements`

All mutations write the domain row and an `outbox` row in one transaction. A worker publishes pending outbox rows to Socket.IO, Ably, Pusher, or Supabase Realtime.

The demo backend already writes outbox-shaped records. Production should move this to the PostgreSQL `outbox` table from `schema.sql`.

Current local storage:

- `server/sqlite-db.mjs` creates and reads normalized SQLite tables.
- `npm.cmd run db:seed` resets and seeds `server/data/arbor-os.sqlite`.
- `prisma/schema.prisma` is kept as a migration contract for the later Prisma/Postgres cutover.

### Demo Socket.IO

The runnable backend exposes Socket.IO on the same origin as REST.

Client flow:

```ts
const socket = io(API_URL, { auth: { token } });
socket.emit('subscribe', ['branch:krk:orders', 'valuations'], (ack) => {
  console.log(ack.accepted, ack.rejected);
});
socket.on('arbor.event', (event) => refreshBootstrap());
```

Server-side subscription authorization uses the JWT role/branch/team claims. For example, `BRYGADZISTA` can subscribe to `team:{ownTeamId}` but receives `rejected: ['invoices']` when trying to subscribe to accounting channels.

## Zadarma

- `POST /api/zadarma/call`
- `GET|POST /api/zadarma/webhook`
- `GET /api/zadarma/recordings/:callId`

Never expose `ZADARMA_SECRET` to the browser. Store recordings encrypted and enforce retention.

The local backend implements these as safe contract stubs: click-to-call and incoming-call webhooks create audit/outbox events, while recordings return encrypted-retention metadata without exposing a real file URL.

## AI Call Analysis

- `POST /api/call-analyses/:recordingId/run`
- Pipeline: recording -> STT/diarization -> LLM JSON score -> `call_analyses` -> `valuation.analysis_ready` realtime event.

The local backend returns a deterministic analysis-shaped response and emits `call_analysis.ready` so the UI/realtime path can be tested before Whisper/Deepgram/LLM credentials are connected.

## Offline Mobile

- `POST /api/mobile/meeting-recordings`

Field estimators upload a mobile meeting recording with `orderId`, `recordingUrl` or `recordingId`, optional transcript lines, optional `promptId`, and optional proposed valuation fields. The backend verifies tenant/branch visibility, creates a `mobile_meeting` communication, runs the active `field_meeting` AI prompt when transcript data is available, updates or creates the valuation, appends order/client timeline events, and emits realtime notifications.

Mobile mutations use client-generated ids and `rev`. When offline, the app queues mutations locally and sends them to `POST /api/sync/mutations` after reconnect. Server responses include accepted events and conflicts.
