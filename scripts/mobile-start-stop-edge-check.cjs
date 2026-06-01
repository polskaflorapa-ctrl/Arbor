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

assertIncludes('docs/MOBILE-START-STOP-WORKLOG-EDGE-CASES.md', [
  'TASK_WORK_LOG_ACTIVE',
  'TASK_WORK_LOG_NOT_FOUND',
  'TASK_WORK_LOG_ALREADY_STOPPED',
  'TASK_NOT_STARTABLE',
  'GO',
  'NO-GO',
]);

assertIncludes('os/src/routes/tasks.js', [
  'TASK_WORK_LOG_ACTIVE',
  'TASK_WORK_LOG_NOT_FOUND',
  'TASK_WORK_LOG_ALREADY_STOPPED',
  'TASK_NOT_STARTABLE',
  "SELECT id, user_id, start_time FROM work_logs WHERE task_id = $1 AND end_time IS NULL",
  "SELECT id, end_time FROM work_logs WHERE id = $1 AND task_id = $2 FOR UPDATE",
  "data_zakonczenia = COALESCE(data_zakonczenia, NOW())",
  "task:${taskId}:start",
  "task:${taskId}:stop",
  'idempotent_replay',
]);

assertIncludes('os/tests/tasks.test.js', [
  'rejects team stop without GPS before touching work logs',
  'rejects stop for missing active work log',
  'rejects duplicate stop for already closed work log',
  'stores stop GPS and closes task date for active work log',
  'POST /tasks/:id/start rejects duplicate active work log',
  'POST /tasks/:id/start rejects closed task status',
]);

assertIncludes('mobile/app/zlecenie/[id].tsx', [
  'createOfflineRequestId(`task-${id}-start`)',
  'createOfflineRequestId(`task-${id}-checkin`)',
  'queueTaskWorkSignalOffline',
  'addPendingOfflineWorkSignal',
]);

assertIncludes('mobile/utils/offline-queue.ts', [
  'queueTaskWorkSignalOffline',
  "dedupeKey: args.id ? `work:${args.kind}:${args.id}` : undefined",
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:mobile-start-stop-edge',
  'MOBILE-START-STOP-WORKLOG-EDGE-CASES.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'mobile START/STOP work log edge cases',
  'verify:mobile-start-stop-edge',
  '**2.1** START / STOP',
]);

assertIncludes('package.json', [
  'verify:mobile-start-stop-edge',
]);

console.log('mobile START/STOP work log edge check passed');
