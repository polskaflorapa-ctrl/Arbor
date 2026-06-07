const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runIntegrationsReleaseCheck,
  assertIncludes,
  assertPackageScripts,
} = require('./integrations-release-check.cjs');

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'integrations-release-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('integrations release check validates docs, package script, backend guards, and UI tests', () => {
  withFixture((root) => {
    writeFixtureFile(
      root,
      'package.json',
      JSON.stringify({ scripts: { 'verify:integrations-release': 'node ./scripts/integrations-release-check.cjs' } }),
    );
    writeFixtureFile(
      root,
      'web/docs/release-checklist-integrations.md',
      'npm run verify:integrations-release Integrations release gate retry single + batch rate limit + cooldown denylist manual/presets/rollback CSV exports RBAC: retry endpoints and channel permissions GO NO-GO',
    );
    writeFixtureFile(
      root,
      'web/docs/go-no-go-integrations.md',
      'npm run verify:integrations-release Retry endpoints protected by role checks Channel-level retry permissions confirmed Rollback max age restriction confirmed Audit trail records actor Smoke test completed GO NO-GO',
    );
    writeFixtureFile(
      root,
      'web/server/routes/fullStack.js',
      "router.post('/integrations/logs/:id/retry') router.post('/integrations/logs/retry-batch') router.patch('/integrations/security/denylist') router.post('/integrations/security/denylist/preset') router.post('/integrations/security/denylist/rollback/:historyId') router.get('/integrations/logs/export') router.get('/integrations/retry-audit') mode: 'single' mode: 'batch' retry_after_ms Brak uprawnie Retry zablokowany DENYLIST_ROLLBACK_MAX_AGE_DAYS",
    );
    writeFixtureFile(
      root,
      'web/src/pages/Integracje.js',
      "Retry cooldown Retry batch Eksport CSV Zapisz denylist applyDenylistPreset('block_sms_global') applyDenylistPreset('allow_all_channels') applyDenylistPreset('clear_all') Cofnij do tego niedost denylist-history-",
    );
    writeFixtureFile(
      root,
      'web/src/pages/Integracje.test.js',
      'single log retry calls POST /integrations/logs/:id/retry retry batch without selection does not call batch endpoint auto-refresh checkbox toggles without throwing manages denylist presets rollback and history export /integrations/security/denylist /integrations/security/denylist/preset /integrations/security/denylist/rollback/41 denylist-history-',
    );

    assert.deepEqual(runIntegrationsReleaseCheck(root), { ok: true });
  });
});

test('package script assertion reports missing integration release script', () => {
  withFixture((root) => {
    writeFixtureFile(root, 'package.json', JSON.stringify({ scripts: { check: 'node ok' } }));

    assert.throws(
      () => assertPackageScripts('package.json', ['verify:integrations-release'], root),
      /verify:integrations-release/,
    );
  });
});

test('text assertion reports missing integration release evidence', () => {
  withFixture((root) => {
    writeFixtureFile(root, 'web/docs/go-no-go-integrations.md', 'GO');

    assert.throws(
      () => assertIncludes('web/docs/go-no-go-integrations.md', ['GO', 'NO-GO'], root),
      /NO-GO/,
    );
  });
});
