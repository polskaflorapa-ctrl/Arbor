const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('mobile offline conflict/idempotency checker passes against repository contract', () => {
  const result = spawnSync(process.execPath, ['scripts/mobile-offline-conflict-check.cjs'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /mobile offline conflict\/idempotency check passed/);
});
