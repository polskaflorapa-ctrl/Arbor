const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'utils', 'testMode.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: sourcePath,
}).outputText;

function createHarness() {
  const storage = new Map();
  const session = {
    current: { token: null, user: null },
    clearCalls: 0,
    saveCalls: [],
  };
  const asyncStorage = {
    async getItem(key) {
      return storage.get(key) ?? null;
    },
    async setItem(key, value) {
      storage.set(key, String(value));
    },
    async removeItem(key) {
      storage.delete(key);
    },
    async multiSet(entries) {
      for (const [key, value] of entries) storage.set(key, String(value));
    },
    async multiRemove(keys) {
      for (const key of keys) storage.delete(key);
    },
  };
  const sessionApi = {
    async getStoredSession() {
      return session.current;
    },
    async saveStoredSession(token, user) {
      session.saveCalls.push({ token, user });
      session.current = { token, user };
    },
    async clearStoredSession() {
      session.clearCalls += 1;
      session.current = { token: null, user: null };
    },
  };
  const moduleRef = { exports: {} };
  const localRequire = (id) => {
    if (id === '@react-native-async-storage/async-storage') {
      return { __esModule: true, default: asyncStorage };
    }
    if (id === '../constants/api') {
      return { API_URL: 'https://api.test/api' };
    }
    if (id === './session') return sessionApi;
    throw new Error(`Unexpected require: ${id}`);
  };
  new Function('require', 'exports', 'module', compiled)(localRequire, moduleRef.exports, moduleRef);
  return { api: moduleRef.exports, session, storage };
}

async function run() {
  const previousDev = global.__DEV__;
  const previousFlag = process.env.EXPO_PUBLIC_ENABLE_TEST_MODE;
  const previousFetch = global.fetch;
  const { api, session, storage } = createHarness();

  try {
    global.__DEV__ = false;
    delete process.env.EXPO_PUBLIC_ENABLE_TEST_MODE;
    assert.equal(api.canUseTestMode(), false);
    process.env.EXPO_PUBLIC_ENABLE_TEST_MODE = 'true';
    assert.equal(api.canUseTestMode(), true);
    delete process.env.EXPO_PUBLIC_ENABLE_TEST_MODE;
    global.__DEV__ = true;
    assert.equal(api.canUseTestMode(), true);

    global.__DEV__ = false;
    storage.set('arbor-mobile-test-mode', 'true');
    storage.set('arbor-mobile-test-user', 'dyrektor');
    storage.set('token', 'test_token_mobile_legacy');
    session.current = { token: 'test_token_mobile_secure', user: { id: 9001 } };
    await api.clearUnavailableTestModeState();
    assert.equal(storage.has('arbor-mobile-test-mode'), false);
    assert.equal(storage.has('arbor-mobile-test-user'), false);
    assert.equal(storage.has('token'), false);
    assert.equal(session.clearCalls, 1);

    global.__DEV__ = true;
    const login = await api.loginTestUserMobile('kierownik');
    assert.ok(login.token.startsWith('test_token_mobile_'));
    assert.equal(session.saveCalls.length, 1);
    assert.equal(session.saveCalls[0].token, login.token);
    assert.equal(storage.has('token'), false, 'test login must not write the legacy token key');
    assert.equal(storage.get('arbor-mobile-test-mode'), 'true');
    assert.equal(storage.get('arbor-mobile-test-user'), 'kierownik');

    const originalFetch = async () => new Response('{}', { status: 200 });
    global.fetch = originalFetch;
    const cleanup = await api.installMobileTestModeFetchInterceptor();
    const patchedFetch = global.fetch;
    assert.notEqual(patchedFetch, originalFetch);
    assert.equal(await api.installMobileTestModeFetchInterceptor(), cleanup);
    cleanup();
    assert.equal(global.fetch, originalFetch);
    cleanup();
    assert.equal(global.fetch, originalFetch, 'fetch cleanup must be idempotent');

    storage.set('arbor-mobile-test-mode', 'true');
    const cleanupAfterDisable = await api.installMobileTestModeFetchInterceptor();
    assert.notEqual(global.fetch, originalFetch);
    await api.toggleTestModeMobile(false);
    assert.equal(global.fetch, originalFetch);
    assert.equal(storage.has('arbor-mobile-test-mode'), false);
    assert.equal(storage.has('arbor-mobile-test-user'), false);
    assert.equal(session.clearCalls, 2);
    cleanupAfterDisable();

    console.log('ok testTestModeGuardAndSession');
  } finally {
    global.fetch = previousFetch;
    if (previousDev === undefined) delete global.__DEV__;
    else global.__DEV__ = previousDev;
    if (previousFlag === undefined) delete process.env.EXPO_PUBLIC_ENABLE_TEST_MODE;
    else process.env.EXPO_PUBLIC_ENABLE_TEST_MODE = previousFlag;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
