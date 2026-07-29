const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'utils', 'api-client.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: sourcePath,
}).outputText;

function loadApiClient() {
  const moduleRef = { exports: {} };
  const localRequire = (id) => {
    if (id === '../constants/api') return { getApiUrl: () => 'https://api.test/api' };
    throw new Error(`Unexpected require: ${id}`);
  };
  new Function('require', 'exports', 'module', compiled)(localRequire, moduleRef.exports, moduleRef);
  return moduleRef.exports;
}

function abortableFetch(_input, init = {}) {
  return new Promise((_resolve, reject) => {
    const rejectAbort = () => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (init.signal?.aborted) {
      rejectAbort();
      return;
    }
    init.signal?.addEventListener('abort', rejectAbort, { once: true });
  });
}

async function testUrlAndHeaders() {
  const api = loadApiClient();
  assert.equal(api.apiUrl('/tasks'), 'https://api.test/api/tasks');
  assert.equal(api.apiUrl('tasks'), 'https://api.test/api/tasks');
  assert.equal(api.apiUrl('https://other.test/x'), 'https://other.test/x');
  assert.deepEqual(api.jsonHeaders('token-1', { 'X-Test': '1' }), {
    'Content-Type': 'application/json',
    'X-Test': '1',
    Authorization: 'Bearer token-1',
  });
}

async function testTimeoutStillWorksWithExternalSignal() {
  const api = loadApiClient();
  const originalFetch = global.fetch;
  global.fetch = abortableFetch;
  try {
    const external = new AbortController();
    await assert.rejects(
      api.fetchWithTimeout('https://api.test/slow', { signal: external.signal }, 15),
      (error) => error?.name === 'AbortError',
    );
    assert.equal(external.signal.aborted, false, 'internal timeout must not abort the caller signal');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testExternalAbortIsForwarded() {
  const api = loadApiClient();
  const originalFetch = global.fetch;
  global.fetch = abortableFetch;
  try {
    const external = new AbortController();
    const pending = api.fetchWithTimeout('https://api.test/slow', { signal: external.signal }, 1000);
    external.abort();
    await assert.rejects(pending, (error) => error?.name === 'AbortError');
  } finally {
    global.fetch = originalFetch;
  }
}

async function run() {
  const tests = [testUrlAndHeaders, testTimeoutStillWorksWithExternalSignal, testExternalAbortIsForwarded];
  for (const test of tests) {
    await test();
    console.log(`ok ${test.name}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
