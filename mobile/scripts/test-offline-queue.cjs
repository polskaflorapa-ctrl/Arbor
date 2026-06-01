const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'utils', 'offline-queue.ts');
const taskCacheSourcePath = path.join(repoRoot, 'utils', 'task-list-cache.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: sourcePath,
}).outputText;
const taskCacheCompiled = ts.transpileModule(fs.readFileSync(taskCacheSourcePath, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: taskCacheSourcePath,
}).outputText;

const OFFLINE_QUEUE_KEY = 'offline_queue_v1';

function createHarness() {
  const storage = new Map();
  const events = [];
  const asyncStorage = {
    async getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    async setItem(key, value) {
      storage.set(key, String(value));
    },
    async removeItem(key) {
      storage.delete(key);
    },
    async multiRemove(keys) {
      keys.forEach((key) => storage.delete(key));
    },
  };
  const module = { exports: {} };
  const localRequire = (id) => {
    if (id === '@react-native-async-storage/async-storage') {
      return { __esModule: true, default: asyncStorage };
    }
    if (id === './offline-queue-sync-events') {
      return { emitOfflineFlushDone: (payload) => events.push(payload) };
    }
    throw new Error(`Unexpected require: ${id}`);
  };
  const fn = new Function('require', 'exports', 'module', compiled);
  fn(localRequire, module.exports, module);
  const api = module.exports;
  const readQueue = () => JSON.parse(storage.get(OFFLINE_QUEUE_KEY) || '[]');
  const writeQueue = (items) => storage.set(OFFLINE_QUEUE_KEY, JSON.stringify(items));
  return { api, events, readQueue, storage, writeQueue };
}

function createTaskCacheHarness() {
  const storage = new Map();
  const asyncStorage = {
    async getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    async setItem(key, value) {
      storage.set(key, String(value));
    },
  };
  const module = { exports: {} };
  const localRequire = (id) => {
    if (id === '@react-native-async-storage/async-storage') {
      return { __esModule: true, default: asyncStorage };
    }
    throw new Error(`Unexpected require: ${id}`);
  };
  const fn = new Function('require', 'exports', 'module', taskCacheCompiled);
  fn(localRequire, module.exports, module);
  return { api: module.exports, storage };
}

function response(status, body = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

async function testDedupeAndLimit() {
  const { api, readQueue } = createHarness();
  await api.enqueueOfflineRequest({
    dedupeKey: 'task:1:status',
    url: 'https://api.test/tasks/1/status',
    method: 'PATCH',
    body: { status: 'A' },
  });
  await api.enqueueOfflineRequest({
    dedupeKey: 'task:1:status',
    url: 'https://api.test/tasks/1/status',
    method: 'PATCH',
    body: { status: 'B' },
  });
  assert.equal(readQueue().length, 1);
  assert.deepEqual(readQueue()[0].body, { status: 'B' });

  for (let i = 0; i < 260; i += 1) {
    await api.enqueueOfflineRequest({
      id: `bulk-${i}`,
      url: `https://api.test/${i}`,
      method: 'POST',
      body: { i },
    });
  }
  const queue = readQueue();
  assert.equal(queue.length, 250);
  assert.equal(queue[0].id, 'bulk-10');
  assert.equal(queue[249].id, 'bulk-259');
}

async function testSuccessfulFlushUsesIdempotencyAndClearsQueue() {
  const { api, events, readQueue } = createHarness();
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return response(200);
  };

  await api.enqueueOfflineRequest({
    id: 'req-1',
    url: 'https://api.test/tasks/1/start',
    method: 'POST',
    body: { lat: 50.1 },
  });
  const result = await api.flushOfflineQueue('token-123');

  assert.deepEqual(result, { flushed: 1, left: 0 });
  assert.equal(readQueue().length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.test/tasks/1/start');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token-123');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'req-1');
  assert.equal(calls[0].options.body, JSON.stringify({ lat: 50.1 }));
  assert.deepEqual(events, [{ flushed: 1, left: 0 }]);
}

async function testKnown400IsDroppedAsDone() {
  const { api, readQueue } = createHarness();
  global.fetch = async () => response(400, { reason: 'TASK_ALREADY_FINISHED' });

  await api.enqueueOfflineRequest({
    id: 'finish-1',
    url: 'https://api.test/tasks/1/finish',
    method: 'POST',
    body: { done: true },
  });
  const result = await api.flushOfflineQueue('token-123');

  assert.deepEqual(result, { flushed: 1, left: 0 });
  assert.equal(readQueue().length, 0);
}

async function testKnown409AlreadyFinishedIsDroppedAsDone() {
  const { api, readQueue } = createHarness();
  global.fetch = async () => response(409, { reason: 'TASK_ALREADY_FINISHED' });

  await api.enqueueOfflineRequest({
    id: 'finish-conflict-1',
    url: 'https://api.test/tasks/1/finish',
    method: 'POST',
    body: { done: true },
  });
  const result = await api.flushOfflineQueue('token-123');

  assert.deepEqual(result, { flushed: 1, left: 0 });
  assert.equal(readQueue().length, 0);
}

async function testIncompleteIdempotencyConflictStaysQueued() {
  const { api, readQueue } = createHarness();
  global.fetch = async () => response(409, { reason: 'IDEMPOTENCY_INCOMPLETE' });

  await api.enqueueOfflineRequest({
    id: 'finish-conflict-2',
    url: 'https://api.test/tasks/1/finish',
    method: 'POST',
    body: { done: true },
  });
  const result = await api.flushOfflineQueue('token-123');
  const queue = readQueue();

  assert.deepEqual(result, { flushed: 0, left: 1 });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].attempts, 1);
  assert.match(queue[0].lastError, /IDEMPOTENCY_INCOMPLETE/);
}

async function testFailuresBackoffAndRetryLater() {
  const { api, readQueue } = createHarness();
  let now = Date.parse('2026-05-28T10:00:00.000Z');
  const originalNow = Date.now;
  Date.now = () => now;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return response(500, 'server down');
  };

  try {
    await api.enqueueOfflineRequest({
      id: 'retry-1',
      url: 'https://api.test/tasks/1/status',
      method: 'PATCH',
      body: { status: 'W_Realizacji' },
    });

    assert.deepEqual(await api.flushOfflineQueue('token-123'), { flushed: 0, left: 1 });
    let [item] = readQueue();
    assert.equal(calls, 1);
    assert.equal(item.attempts, 1);
    assert.equal(item.lastError, 'server down');

    assert.deepEqual(await api.flushOfflineQueue('token-123'), { flushed: 0, left: 1 });
    assert.equal(calls, 1, 'backoff should skip immediate retry');

    now += 2500;
    assert.deepEqual(await api.flushOfflineQueue('token-123'), { flushed: 0, left: 1 });
    [item] = readQueue();
    assert.equal(calls, 2);
    assert.equal(item.attempts, 2);
  } finally {
    Date.now = originalNow;
  }
}

async function testQueueStatusExposesRetryAndErrors() {
  const { api } = createHarness();
  let now = Date.parse('2026-05-28T10:00:00.000Z');
  const originalNow = Date.now;
  Date.now = () => now;
  global.fetch = async () => response(500, 'server down');

  try {
    await api.enqueueOfflineRequest({
      id: 'status-1',
      url: 'https://api.test/tasks/1/status',
      method: 'PATCH',
      body: { status: 'W_Realizacji' },
    });
    await api.flushOfflineQueue('token-123');
    const status = await api.getOfflineQueueStatus();

    assert.equal(status.count, 1);
    assert.equal(status.retryBlocked, 1);
    assert.equal(status.lastError, 'server down');
    assert.ok(status.oldestCreatedAt);
  } finally {
    Date.now = originalNow;
  }
}

async function testTaskListCacheReturnsOnlyToday() {
  const { api } = createTaskCacheHarness();
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const todayIso = today.toISOString();
  const yesterdayIso = yesterday.toISOString();
  const endpoint = 'https://api.test/api/tasks/moje';
  const user = { id: 7, rola: 'Brygadzista' };

  await api.saveTaskListCache({
    endpoint,
    user,
    tasks: [
      { id: 1, data_planowana: todayIso },
      { id: 2, data_planowana: yesterdayIso },
      { id: 3, data_planowana: null },
    ],
  });
  const cached = await api.loadTodayTaskListCache({ endpoint, user });

  assert.ok(cached);
  assert.deepEqual(cached.tasks.map((task) => task.id), [1]);
  assert.equal(typeof api.formatTaskListCacheTime(cached.savedAt), 'string');
}

async function testTaskDetailCacheRoundTrip() {
  const { api } = createTaskCacheHarness();
  const user = { id: 11, rola: 'Brygadzista' };

  await api.saveTaskDetailCache({
    taskId: 99,
    user,
    task: { id: 99, klient_nazwa: 'Klient testowy', pomocnicy: [{ id: 1 }] },
    logi: [{ id: 'log-1' }],
    problemy: [{ id: 'problem-1' }],
    zdjecia: [{ id: 'photo-1', typ: 'po' }],
    cmrLista: [{ id: 'cmr-1' }],
  });
  const cached = await api.loadTaskDetailCache({ taskId: 99, user });

  assert.ok(cached);
  assert.equal(cached.task.id, 99);
  assert.deepEqual(cached.logi.map((row) => row.id), ['log-1']);
  assert.deepEqual(cached.problemy.map((row) => row.id), ['problem-1']);
  assert.deepEqual(cached.zdjecia.map((row) => row.typ), ['po']);
  assert.deepEqual(cached.cmrLista.map((row) => row.id), ['cmr-1']);
}

async function testTaskDetailCachePreservesPendingOfflineFieldFlow() {
  const { api } = createTaskCacheHarness();
  const user = { id: 12, rola: 'Brygadzista' };

  await api.saveTaskDetailCache({
    taskId: 101,
    user,
    task: {
      id: 101,
      status: 'Zakonczone',
      active_work_count: 0,
      active_work_started_at: null,
      last_work_finished_at: '2026-05-31T10:30:00.000Z',
      mobile_finish_pending: true,
      mobile_finish_payload: { payment: { forma_platnosc: 'Gotowka', kwota_odebrana: 1200 } },
    },
    logi: [
      {
        id: 'task-101-start-pending',
        start_time: '2026-05-31T09:00:00.000Z',
        end_time: '2026-05-31T10:30:00.000Z',
        offline_pending: true,
        offline_finish_pending: true,
      },
      {
        id: 'task-101-checkin-pending',
        status: 'check_in',
        start_time: '2026-05-31T08:55:00.000Z',
        offline_pending: true,
      },
    ],
    problemy: [
      {
        id: 'task-101-problem-pending',
        status: 'Czeka na sync',
        opis: 'Testowy problem offline',
        offline_pending: true,
      },
    ],
    zdjecia: [
      {
        id: 'task-101-photo-before-pending',
        typ: 'przed',
        url: 'file:///tmp/photo-before.jpg',
        offline_pending: true,
      },
      {
        id: 'task-101-photo-after-pending',
        typ: 'po',
        url: 'file:///tmp/photo-after.jpg',
        offline_pending: true,
      },
    ],
    cmrLista: [],
  });
  const cached = await api.loadTaskDetailCache({ taskId: 101, user });

  assert.ok(cached);
  assert.equal(cached.task.mobile_finish_pending, true);
  assert.equal(cached.task.mobile_finish_payload.payment.kwota_odebrana, 1200);
  assert.equal(cached.logi.some((row) => row.offline_pending === true), true);
  assert.equal(cached.logi.some((row) => row.offline_finish_pending === true), true);
  assert.equal(cached.problemy[0].offline_pending, true);
  assert.equal(cached.zdjecia.every((row) => row.offline_pending === true), true);
  assert.deepEqual(cached.zdjecia.map((row) => row.typ), ['przed', 'po']);
  assert.deepEqual(cached.zdjecia.map((row) => row.url), ['file:///tmp/photo-before.jpg', 'file:///tmp/photo-after.jpg']);
}

async function testQueueTaskProblemOfflineUsesStableIdAndDedupe() {
  const { api, readQueue } = createHarness();

  const count = await api.queueTaskProblemOffline({
    id: 'problem-offline-1',
    url: 'https://api.example.test/tasks/101/problemy',
    typ: 'brak_dostepu',
    opis: 'Brama zamknieta',
  });
  await api.queueTaskProblemOffline({
    id: 'problem-offline-1',
    url: 'https://api.example.test/tasks/101/problemy',
    typ: 'brak_dostepu',
    opis: 'Brama nadal zamknieta',
  });

  const queue = readQueue();
  assert.equal(count, 1);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, 'problem-offline-1');
  assert.equal(queue[0].dedupeKey, 'problem:problem-offline-1');
  assert.equal(queue[0].url, 'https://api.example.test/tasks/101/problemy');
  assert.equal(queue[0].method, 'POST');
  assert.deepEqual(queue[0].body, {
    typ: 'brak_dostepu',
    opis: 'Brama nadal zamknieta',
  });
}

async function run() {
  const tests = [
    testDedupeAndLimit,
    testSuccessfulFlushUsesIdempotencyAndClearsQueue,
    testKnown400IsDroppedAsDone,
    testKnown409AlreadyFinishedIsDroppedAsDone,
    testIncompleteIdempotencyConflictStaysQueued,
    testFailuresBackoffAndRetryLater,
    testQueueStatusExposesRetryAndErrors,
    testTaskListCacheReturnsOnlyToday,
    testTaskDetailCacheRoundTrip,
    testTaskDetailCachePreservesPendingOfflineFieldFlow,
    testQueueTaskProblemOfflineUsesStableIdAndDedupe,
  ];
  for (const test of tests) {
    await test();
    console.log(`ok ${test.name}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
