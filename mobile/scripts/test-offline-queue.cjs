const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'utils', 'offline-queue.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: sourcePath,
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

async function run() {
  const tests = [
    testDedupeAndLimit,
    testSuccessfulFlushUsesIdempotencyAndClearsQueue,
    testKnown400IsDroppedAsDone,
    testFailuresBackoffAndRetryLater,
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
