const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'utils', 'notification-deeplink.ts');
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
const { getNotificationDeepLink } = moduleRef.exports;

function run() {
  assert.equal(getNotificationDeepLink({ taskId: 123 }), '/zlecenie/123');
  assert.equal(getNotificationDeepLink({ task_id: '456', tab: 'problemy' }), '/zlecenie/456?tab=problemy');
  assert.equal(getNotificationDeepLink({ zlecenie_id: '789', tab: '../bad' }), '/zlecenie/789');
  assert.equal(getNotificationDeepLink({ path: '/harmonogram?date=2026-05-31' }), '/harmonogram?date=2026-05-31');
  assert.equal(getNotificationDeepLink({ url: 'https://app.example.com/zlecenie/15?tab=zdjecia' }), '/zlecenie/15?tab=zdjecia');
  assert.equal(getNotificationDeepLink({ screen: '/autoplan-dnia' }), '/autoplan-dnia');
  assert.equal(getNotificationDeepLink({ type: 'quotation_approval' }), '/wyceny-terenowe');
  assert.equal(getNotificationDeepLink({ type: 'reservation_day_end' }), '/rezerwacje-sprzetu');
  assert.equal(getNotificationDeepLink({ url: 'https://evil.example.com//bad' }), '/powiadomienia');
  assert.equal(getNotificationDeepLink({}), '/powiadomienia');
  assert.equal(getNotificationDeepLink(undefined), '/powiadomienia');
  console.log('ok testNotificationDeepLink');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
