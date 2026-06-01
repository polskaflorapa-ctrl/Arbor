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

assertIncludes('docs/MOBILE-TODAY-TASKS-OFFLINE-CACHE.md', [
  'TASK_LIST_CACHE_TTL_MS',
  'TASK_LIST_CACHE_STALE_MS',
  'loadTodayTaskListCache',
  'recache',
  'verify:mobile-today-cache',
]);

assertIncludes('mobile/utils/task-list-cache.ts', [
  'export const TASK_LIST_CACHE_TTL_MS = 18 * 60 * 60 * 1000',
  'export const TASK_LIST_CACHE_STALE_MS = 15 * 60 * 1000',
  'loadTodayTaskListCache',
  'isTaskForToday',
  'formatTaskListCacheNotice',
]);

assertIncludes('mobile/app/zlecenia.tsx', [
  'saveTaskListCache',
  'loadTodayTaskListCache',
  'formatTaskListCacheNotice',
  "setQuickMode('today')",
  'subscribeOfflineFlushDone',
]);

assertIncludes('mobile/app/misja-dnia.tsx', [
  'saveTaskListCache',
  'loadTodayTaskListCache',
  'formatTaskListCacheNotice',
  'subscribeOfflineFlushDone',
  'Plan offline',
]);

assertIncludes('mobile/scripts/test-offline-queue.cjs', [
  'testTaskListCacheReturnsOnlyToday',
  'testTaskListCacheMarksStaleAndExpiresAfterTtl',
  'TASK_LIST_CACHE_TTL_MS',
  'starsze niz 15 min',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:mobile-today-cache',
  'MOBILE-TODAY-TASKS-OFFLINE-CACHE.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'mobile today',
  'verify:mobile-today-cache',
  '2.6',
]);

assertIncludes('package.json', [
  'verify:mobile-today-cache',
]);

console.log('mobile today tasks offline cache check passed');
