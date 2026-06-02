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
  'Idempotency-Key',
  'idempotent_replay',
  'task_kommo_sync_queue',
  'dead_letter',
  'force=true',
  'GO',
  'NO-GO',
]);

assertIncludes('os/src/routes/crmWebhooks.js', [
  "req.get('Idempotency-Key')",
  "req.get('X-Idempotency-Key')",
  'ingestWebhook',
]);

assertIncludes('os/src/services/crmIntegrations.js', [
  'idempotency_key',
  'findIdempotentIntegrationEvent',
  'idempotent_replay',
  'external_id',
  'crm_lead_messages',
]);

assertIncludes('os/src/services/kommo.js', [
  'kommoTaskSyncIdempotencyKey',
  'idempotency_key',
  'idempotency-key',
  'x-idempotency-key',
  'dead_letter',
  'next_retry_at',
]);

assertIncludes('os/src/routes/tasks.js', [
  'kommo-retry',
  'force',
  'dead_letter',
  'idempotency_key',
  'kommo-sync/diagnostics',
]);

assertIncludes('os/tests/crm-integrations.test.js', [
  'Idempotency-Key',
  'idempotent_replay',
  'without duplicating lead or message',
]);

assertIncludes('os/tests/kommo-task-sync-queue.test.js', [
  'stable idempotency headers',
  'kommoTaskSyncIdempotencyKey',
  'idempotency-key',
]);

assertIncludes('os/tests/kommo-payload-service.test.js', [
  'payload.idempotency_key',
  'payload.task.sync_meta.idempotency_key',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:kommo-idempotency-retry',
  'KOMMO-IDEMPOTENCY-RETRY-DEADLETTER-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'Kommo idempotency retry',
  'verify:kommo-idempotency-retry',
  '**8.3**',
]);

assertIncludes('package.json', [
  'verify:kommo-idempotency-retry',
]);

console.log('kommo idempotency retry contract check passed');
