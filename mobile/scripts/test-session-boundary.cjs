const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'utils', 'session.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: sourcePath,
}).outputText;

function createHarness() {
  const storage = new Map();
  const secureStorage = new Map();
  const cleanup = { offline: 0, taskCaches: 0 };
  const asyncStorage = {
    async getItem(key) {
      return storage.get(key) ?? null;
    },
    async multiGet(keys) {
      return keys.map((key) => [key, storage.get(key) ?? null]);
    },
    async setItem(key, value) {
      storage.set(key, String(value));
    },
    async multiSet(entries) {
      for (const [key, value] of entries) storage.set(key, String(value));
    },
    async removeItem(key) {
      storage.delete(key);
    },
    async multiRemove(keys) {
      for (const key of keys) storage.delete(key);
    },
  };
  const secureStore = {
    async getItemAsync(key) {
      return secureStorage.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      secureStorage.set(key, String(value));
    },
    async deleteItemAsync(key) {
      secureStorage.delete(key);
    },
  };
  const moduleRef = { exports: {} };
  const localRequire = (id) => {
    if (id === '@react-native-async-storage/async-storage') {
      return { __esModule: true, default: asyncStorage };
    }
    if (id === 'expo-secure-store') return secureStore;
    if (id === './offline-queue') {
      return { clearOfflineQueue: async () => { cleanup.offline += 1; } };
    }
    if (id === './task-list-cache') {
      return { clearTaskCaches: async () => { cleanup.taskCaches += 1; } };
    }
    throw new Error(`Unexpected require: ${id}`);
  };
  new Function('require', 'exports', 'module', compiled)(localRequire, moduleRef.exports, moduleRef);
  return { api: moduleRef.exports, cleanup, secureStorage, storage };
}

async function run() {
  const { api, cleanup, secureStorage, storage } = createHarness();

  await api.saveStoredSession('token-a', { id: 1, imie: 'A' });
  assert.deepEqual(cleanup, { offline: 1, taskCaches: 1 });
  assert.equal(secureStorage.get('session_token_v1'), 'token-a');
  assert.equal(JSON.parse(storage.get('user')).id, 1);

  await api.saveStoredSession('token-a-refreshed', { id: 1, imie: 'A2' });
  assert.deepEqual(cleanup, { offline: 1, taskCaches: 1 }, 'same-user refresh must preserve offline data');

  await api.saveStoredSession('token-b', { id: 2, imie: 'B' });
  assert.deepEqual(cleanup, { offline: 2, taskCaches: 2 }, 'user switch must clear session-bound data');
  assert.equal(JSON.parse(storage.get('user')).id, 2);

  storage.set('token', 'legacy-token');
  await api.clearStoredSession();
  assert.deepEqual(cleanup, { offline: 3, taskCaches: 3 });
  assert.equal(secureStorage.has('session_token_v1'), false);
  assert.equal(storage.has('token'), false);
  assert.equal(storage.has('user'), false);

  console.log('ok testSessionBoundaryCleanup');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
