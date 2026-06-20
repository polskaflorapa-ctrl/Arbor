const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function assertIncludes(file, needles) {
  const text = read(file);
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length) throw new Error(`${file} missing: ${missing.join(', ')}`);
}

assertIncludes('os/src/app.js', [
  'buildMobileConfigPayload',
  'version: API_VERSION',
  'apiVersion: API_VERSION',
  'appFlags: { ...API_FEATURES }',
  'oddzialFeatureOverrides: {}',
  "app.get('/api/mobile-config'",
  "app.get('/api/config/mobile'",
  "res.setHeader('X-Api-Version', API_VERSION)",
]);

assertIncludes('os/tests/health.test.js', [
  'GET /api/mobile-config',
  "for (const path of ['/api/mobile-config', '/api/config/mobile'])",
  "expect(res.headers['x-api-version']).toBe('2.2.0-quotations')",
  'quotationPublicAcceptance: true',
  'oddzialFeatureOverrides: {}',
]);

assertIncludes('mobile/utils/mobile-remote-config.ts', [
  "const paths = ['/mobile-config', '/config/mobile']",
  "res.headers.get('x-api-version')",
  'mergeAppRemoteFlags(appFlags)',
  'oddzialFeatureOverrides',
  'mergeRemoteOddzialFeatureOverrides(raw)',
]);

assertIncludes('mobile/docs/backend-handoff-rezerwacje.md', [
  'GET /api/mobile-config',
  '`mobile-config` -> `200`',
  'X-Api-Version',
  'appFlags',
  'oddzialFeatureOverrides',
  'verify:mobile-config',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:mobile-config',
  'mobile-config',
]);

assertIncludes('package.json', [
  'verify:mobile-config',
]);

console.log('mobile config contract check passed');
