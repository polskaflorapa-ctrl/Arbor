const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'utils', 'error-monitoring.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: sourcePath,
}).outputText;

const sentryCalls = {
  init: [],
  setTag: [],
  captureException: [],
  captureMessage: [],
};

const sentryMock = {
  init: (options) => sentryCalls.init.push(options),
  setTag: (...args) => sentryCalls.setTag.push(args),
  captureException: (...args) => sentryCalls.captureException.push(args),
  captureMessage: (...args) => sentryCalls.captureMessage.push(args),
};

function loadModule() {
  const moduleRef = { exports: {} };
  const fn = new Function('require', 'exports', 'module', compiled);
  fn((id) => {
    if (id === 'expo-constants') {
      return { __esModule: true, default: { expoConfig: { version: '1.2.3', slug: 'arbor-mobile' }, nativeBuildVersion: '45' } };
    }
    if (id === '@sentry/react-native') {
      return sentryMock;
    }
    return require(id);
  }, moduleRef.exports, moduleRef);
  return moduleRef.exports;
}

function resetCalls() {
  for (const key of Object.keys(sentryCalls)) {
    sentryCalls[key].length = 0;
  }
}

function run() {
  const oldDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  const oldEnv = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT;
  const oldTrace = process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;

  try {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    delete process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT;
    delete process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
    let mod = loadModule();
    assert.equal(mod.getErrorMonitoringConfig().enabled, false);
    mod.initErrorMonitoring();
    assert.equal(sentryCalls.init.length, 0);
    mod.captureAppError(new Error('no dsn'));
    assert.equal(sentryCalls.captureException.length, 0);

    resetCalls();
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@example.com/1';
    process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT = 'preview';
    process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE = '0.25';
    mod = loadModule();
    const config = mod.initErrorMonitoring();
    assert.equal(config.enabled, true);
    assert.equal(config.environment, 'preview');
    assert.equal(config.tracesSampleRate, 0.25);
    assert.equal(sentryCalls.init.length, 1);
    assert.equal(sentryCalls.init[0].release, 'arbor-mobile@1.2.3');
    assert.equal(sentryCalls.init[0].dist, '45');

    mod.captureAppError(new Error('boom'), { source: 'test' });
    mod.captureAppMessage('hello', { source: 'test' });
    assert.equal(sentryCalls.captureException.length, 1);
    assert.equal(sentryCalls.captureMessage.length, 1);

    console.log('ok testErrorMonitoring');
  } finally {
    process.env.EXPO_PUBLIC_SENTRY_DSN = oldDsn;
    process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT = oldEnv;
    process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE = oldTrace;
  }
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
