const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function assertIncludes(file, needles) {
  const text = read(file);
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length) throw new Error(`${file} missing: ${missing.join(', ')}`);
}

assertIncludes('docs/KOMMO-IDEMPOTENCY-RETRY-DEADLETTER-CONTRACT.md', [
  'task_kommo_sync_queue',
  'dead_letter',
  'task_kommo_inbound_events',
  'event_key',
  '/api/tasks/kommo-sync/diagnostics',
  'force=true',
  'GO',
  'NO-GO',
]);

assertIncludes('os/src/services/kommo.js', [
  'ensureKommoTaskSyncQueue',
  'recordKommoTaskSyncFailure',
  'markKommoTaskSyncSuccess',
  'retryDelayMinutes',
  'dead_letter',
  'UNIQUE (task_id, event)',
  'payload_json',
  'actor_json',
]);

assertIncludes('os/src/routes/kommoQuotationWebhook.js', [
  'stableEventKey',
  'task_kommo_inbound_events',
  'SELECT * FROM task_kommo_inbound_events WHERE event_key = $1',
  'duplicate: true',
  "status: 'conflict'",
  "status: 'error'",
  'recordInboundEvent',
  "kommo_last_sync_status = 'conflict'",
]);

assertIncludes('os/src/routes/tasks.js', [
  'kommo-sync/diagnostics',
  'task_kommo_sync_queue',
  'task_kommo_inbound_events',
  'queue_errors',
  'inbound_conflicts',
  'kommo-retry',
  'force',
  'dead_letter',
]);

assertIncludes('os/tests/kommo-task-sync-queue.test.js', [
  'records failed task.sync with retry counter and payload snapshot',
  'moves task.sync to dead_letter after retry limit',
  'marks task.sync as sent and clears retry metadata',
]);

assertIncludes('os/tests/kommo-task-inbound-webhook.test.js', [
  'applies task.sync idempotently to an open task',
  'returns duplicate without updating task when event key already exists',
  'records conflict when Kommo tries to reopen a closed task',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:kommo-idempotency-retry',
  'KOMMO-IDEMPOTENCY-RETRY-DEADLETTER-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'Kommo idempotency retry contract',
  'verify:kommo-idempotency-retry',
  '**8.3**',
]);

assertIncludes('package.json', [
  'verify:kommo-idempotency-retry',
]);

console.log('Kommo idempotency/retry/dead-letter contract check passed');
