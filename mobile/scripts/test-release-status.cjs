const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

function run() {
  const result = spawnSync(process.execPath, ['./scripts/mobile-release-status.cjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Arbor Mobile release status/);
  assert.match(result.stdout, /Store metadata/);
  assert.match(result.stdout, /Marketing URL\s+https:\/\/arbo-os\.com/);
  assert.match(result.stdout, /Support URL\s+https:\/\/arbo-os\.com\/support\.html/);
  assert.match(result.stdout, /Privacy URL\s+https:\/\/arbo-os\.com\/privacy\.html/);
  assert.match(result.stdout, /Manual store gates\s+6/);
  assert.match(result.stdout, /Legal review required\s+yes/);
  assert.match(result.stdout, /npm run release:store-check/);
  assert.match(result.stdout, /Store manual gates need owner evidence/);

  console.log('ok testReleaseStatus');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
