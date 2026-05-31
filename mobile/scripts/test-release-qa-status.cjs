const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'utils', 'release-qa-status.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: sourcePath,
}).outputText;

const moduleRef = { exports: {} };
const fn = new Function('require', 'exports', 'module', compiled);
fn(require, moduleRef.exports, moduleRef);

const { buildReleaseQaItems, formatReleaseQaReport, releaseQaSummary } = moduleRef.exports;

function run() {
  const green = buildReleaseQaItems({
    tokenPresent: true,
    apiHealthLevel: 'healthy',
    apiVersionMismatch: false,
    offlineQueueSize: 0,
    sentryEnabled: true,
    liveGpsEnabled: true,
    liveGpsKind: 'active',
    lastAppErrorPresent: false,
  });
  assert.equal(releaseQaSummary(green), 'ok');

  const preview = buildReleaseQaItems({
    tokenPresent: true,
    apiHealthLevel: 'healthy',
    apiVersionMismatch: false,
    offlineQueueSize: 2,
    sentryEnabled: false,
    liveGpsEnabled: true,
    liveGpsKind: 'warning',
    liveGpsReason: 'offline',
    lastAppErrorPresent: true,
  });
  assert.equal(releaseQaSummary(preview), 'warn');
  assert.equal(preview.find((item) => item.key === 'offline-queue').state, 'warn');
  assert.equal(preview.find((item) => item.key === 'sentry').value, 'brak DSN');

  const blocked = buildReleaseQaItems({
    tokenPresent: false,
    apiHealthLevel: 'down',
    apiVersionMismatch: true,
    offlineQueueSize: 0,
    sentryEnabled: false,
    liveGpsEnabled: true,
    liveGpsKind: 'blocked',
    liveGpsReason: 'permission_revoked',
    lastAppErrorPresent: false,
  });
  assert.equal(releaseQaSummary(blocked), 'fail');
  assert.match(formatReleaseQaReport(blocked), /FAIL \| Sesja/);
  assert.match(formatReleaseQaReport(blocked), /Wersja API/);

  console.log('ok testReleaseQaStatus');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
