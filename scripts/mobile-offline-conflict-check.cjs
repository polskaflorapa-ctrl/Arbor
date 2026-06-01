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

assertIncludes('docs/MOBILE-OFFLINE-CONFLICT-IDEMPOTENCY.md', [
  'TASK_ALREADY_FINISHED',
  'IDEMPOTENCY_INCOMPLETE',
  'queueTaskWorkSignalOffline',
  'queueTaskPhotoOffline',
  'queueTaskProblemOffline',
  'queueTaskFinishOffline',
  'GO',
  'NO-GO',
]);

assertIncludes('mobile/utils/offline-queue.ts', [
  "'Idempotency-Key': item.id",
  "SAFE_REPLAY_REASONS = new Set(['TASK_ALREADY_FINISHED'])",
  'IDEMPOTENCY_INCOMPLETE',
  'RETRYABLE_CONFLICT_REASONS',
  'markAttemptFailed',
  'retryDelayMs',
  'queueTaskWorkSignalOffline',
  "dedupeKey: args.id ? `work:${args.kind}:${args.id}` : undefined",
  'queueTaskPhotoOffline',
  "dedupeKey: args.id ? `photo:${args.id}` : undefined",
  'queueTaskProblemOffline',
  "dedupeKey: args.id ? `problem:${args.id}` : undefined",
  'queueTaskFinishOffline',
  "dedupeKey: args.id ? `finish:${args.id}` : undefined",
]);

assertIncludes('mobile/app/zlecenie/[id].tsx', [
  'createOfflineRequestId(`task-${id}-start`)',
  'queueTaskWorkSignalOffline',
  'createOfflineRequestId(`task-${id}-photo`)',
  'queueTaskPhotoOffline',
  'createOfflineRequestId(`task-${id}-problem`)',
  'queueTaskProblemOffline',
  'createOfflineRequestId(`task-${id}-finish`)',
  'queueTaskFinishOffline',
  'addPendingOfflineWorkSignal',
  'addPendingOfflinePhoto',
  'addPendingOfflineProblem',
  'addPendingOfflineFinish',
]);

assertIncludes('mobile/scripts/test-offline-queue.cjs', [
  'testSuccessfulFlushUsesIdempotencyAndClearsQueue',
  'testKnown409AlreadyFinishedIsDroppedAsDone',
  'testIncompleteIdempotencyConflictStaysQueued',
  'testFailuresBackoffAndRetryLater',
  'testQueueTaskWorkSignalOfflineUsesStableIdAndDedupe',
  'testQueueTaskPhotoOfflineUsesStableIdAndDedupe',
  'testQueueTaskProblemOfflineUsesStableIdAndDedupe',
  'testQueueTaskFinishOfflinePreservesMaterialsCostsAndDedupe',
]);

assertIncludes('os/src/routes/tasks.js', [
  "task:${taskId}:start",
  "task:${taskId}:stop",
  "task:${taskId}:finish",
  "task:${taskId}:problem",
  "task:${taskId}:photo",
  'IDEMPOTENCY_INCOMPLETE',
  'TASK_ALREADY_FINISHED',
  'idempotent_replay',
]);

assertIncludes('os/tests/tasks.test.js', [
  'offline-photo-retry-1',
  'Idempotency-Key',
  'TASK_FINISH_MATERIAL_USAGE_REQUIRED',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:mobile-offline-conflicts',
  'MOBILE-OFFLINE-CONFLICT-IDEMPOTENCY.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'mobile offline conflict/idempotency coverage',
  'verify:mobile-offline-conflicts',
  '2.5',
]);

assertIncludes('package.json', [
  'verify:mobile-offline-conflicts',
]);

console.log('mobile offline conflict/idempotency check passed');
