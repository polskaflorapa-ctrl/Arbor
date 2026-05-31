const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'utils', 'app-error-report.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: sourcePath,
}).outputText;

const storage = new Map();
const asyncStorageMock = {
  setItem: async (key, value) => storage.set(key, value),
  getItem: async (key) => storage.get(key) ?? null,
  removeItem: async (key) => storage.delete(key),
};

function localRequire(id) {
  if (id === '@react-native-async-storage/async-storage') {
    return { __esModule: true, default: asyncStorageMock };
  }
  return require(id);
}

const moduleRef = { exports: {} };
const fn = new Function('require', 'exports', 'module', compiled);
fn(localRequire, moduleRef.exports, moduleRef);

const {
  APP_ERROR_REPORT_KEY,
  clearLastAppErrorReport,
  formatAppErrorReport,
  getLastAppErrorReport,
  saveAppErrorReport,
} = moduleRef.exports;

async function run() {
  const saved = await saveAppErrorReport({
    source: 'error-boundary',
    name: 'RenderError',
    message: 'Boom in render',
    stack: 'RenderError: Boom in render',
    componentStack: 'at Screen',
    appRoute: '/dashboard',
  });

  assert.equal(storage.has(APP_ERROR_REPORT_KEY), true);
  assert.equal(saved.message, 'Boom in render');
  assert.equal(saved.source, 'error-boundary');

  const loaded = await getLastAppErrorReport();
  assert.equal(loaded.message, 'Boom in render');
  assert.equal(loaded.name, 'RenderError');
  assert.equal(loaded.appRoute, '/dashboard');

  const text = formatAppErrorReport(loaded);
  assert.match(text, /ARBOR mobile app error report/);
  assert.match(text, /Boom in render/);
  assert.match(text, /Component stack/);

  await clearLastAppErrorReport();
  assert.equal(await getLastAppErrorReport(), null);

  storage.set(APP_ERROR_REPORT_KEY, '{bad json');
  assert.equal(await getLastAppErrorReport(), null);

  console.log('ok testAppErrorReport');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
