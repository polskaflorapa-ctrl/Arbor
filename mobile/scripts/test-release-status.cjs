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
  assert.match(result.stdout, /Production monitoring/);
  assert.match(result.stdout, /Sentry DSN configured\s+no/);
  assert.match(result.stdout, /Sentry sourcemap env\s+missing/);
  assert.match(result.stdout, /Production monitoring gate\s+blocked for production/);
  assert.match(result.stdout, /Production crash\/error monitoring needs Sentry DSN or an approved external destination/);
  assert.match(result.stdout, /npm run release:store-check/);
  assert.match(result.stdout, /Store manual gates need owner evidence/);

  const monitoredResult = spawnSync(process.execPath, ['./scripts/mobile-release-status.cjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      EXPO_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
      SENTRY_AUTH_TOKEN: 'token',
      SENTRY_ORG: 'org',
      SENTRY_PROJECT: 'project',
    },
  });

  assert.equal(monitoredResult.status, 0, monitoredResult.stderr || monitoredResult.stdout);
  assert.match(monitoredResult.stdout, /Sentry DSN configured\s+yes/);
  assert.match(monitoredResult.stdout, /Sentry sourcemap env\s+complete/);
  assert.match(monitoredResult.stdout, /Production monitoring gate\s+ready to verify on device/);
  assert.match(monitoredResult.stdout, /Production crash\/error monitoring must be verified on device/);

  console.log('ok testReleaseStatus');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
