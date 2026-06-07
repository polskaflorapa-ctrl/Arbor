const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(file, baseRoot = root) {
  return fs.readFileSync(path.join(baseRoot, file), 'utf8');
}

function assertIncludes(file, needles, baseRoot = root) {
  const text = read(file, baseRoot);
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length) throw new Error(`${file} missing: ${missing.join(', ')}`);
}

function assertPackageScripts(file, scripts, baseRoot = root) {
  const pkg = JSON.parse(read(file, baseRoot));
  const existing = pkg.scripts || {};
  const missing = scripts.filter((script) => !existing[script]);
  if (missing.length) throw new Error(`${file} missing scripts: ${missing.join(', ')}`);
}

function runIntegrationsReleaseCheck(baseRoot = root) {
  assertPackageScripts('package.json', ['verify:integrations-release'], baseRoot);

  assertIncludes('web/docs/release-checklist-integrations.md', [
    'npm run verify:integrations-release',
    'Integrations release gate',
    'retry single + batch',
    'rate limit + cooldown',
    'denylist manual/presets/rollback',
    'CSV exports',
    'RBAC: retry endpoints and channel permissions',
    'GO',
    'NO-GO',
  ], baseRoot);

  assertIncludes('web/docs/go-no-go-integrations.md', [
    'npm run verify:integrations-release',
    'Retry endpoints protected by role checks',
    'Channel-level retry permissions confirmed',
    'Rollback max age restriction confirmed',
    'Audit trail records actor',
    'Smoke test completed',
    'GO',
    'NO-GO',
  ], baseRoot);

  assertIncludes('web/server/routes/fullStack.js', [
    "router.post('/integrations/logs/:id/retry'",
    "router.post('/integrations/logs/retry-batch'",
    "router.patch('/integrations/security/denylist'",
    "router.post('/integrations/security/denylist/preset'",
    "router.post('/integrations/security/denylist/rollback/:historyId'",
    "router.get('/integrations/logs/export'",
    "router.get('/integrations/retry-audit'",
    "mode: 'single'",
    "mode: 'batch'",
    'retry_after_ms',
    'Brak uprawnie',
    'Retry zablokowany',
    'DENYLIST_ROLLBACK_MAX_AGE_DAYS',
  ], baseRoot);

  assertIncludes('web/src/pages/Integracje.js', [
    'Retry cooldown',
    'Retry batch',
    'Eksport CSV',
    'Zapisz denylist',
    "applyDenylistPreset('block_sms_global')",
    "applyDenylistPreset('allow_all_channels')",
    "applyDenylistPreset('clear_all')",
    'Cofnij do tego',
    'niedost',
    'denylist-history-',
  ], baseRoot);

  assertIncludes('web/src/pages/Integracje.test.js', [
    'single log retry calls POST /integrations/logs/:id/retry',
    'retry batch without selection does not call batch endpoint',
    'auto-refresh checkbox toggles without throwing',
    'manages denylist presets rollback and history export',
    '/integrations/security/denylist',
    '/integrations/security/denylist/preset',
    '/integrations/security/denylist/rollback/41',
    'denylist-history-',
  ], baseRoot);

  return { ok: true };
}

if (require.main === module) {
  runIntegrationsReleaseCheck();
  console.log('integrations release contract check passed');
}

module.exports = {
  assertIncludes,
  assertPackageScripts,
  runIntegrationsReleaseCheck,
};
