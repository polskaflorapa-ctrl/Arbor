const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function readJson(file) {
  return JSON.parse(read(file));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(file, needles) {
  const text = read(file);
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length) throw new Error(`${file} missing: ${missing.join(', ')}`);
}

function assertUrl(value, label) {
  assert(typeof value === 'string' && value.startsWith('https://'), `${label} must be an https URL`);
  assert(!value.includes('example.com'), `${label} must not be a placeholder`);
}

const metadata = readJson('mobile/config/store-metadata.json');
const appJson = readJson('mobile/app.json');

assert(metadata.appName === 'Arbor Mobile', 'store appName must be Arbor Mobile');
assert(metadata.bundleIdentifier === appJson.expo.ios.bundleIdentifier, 'bundleIdentifier must match mobile/app.json');
assert(metadata.androidPackage === appJson.expo.android.package, 'androidPackage must match mobile/app.json');

assertUrl(metadata.marketingUrl, 'marketingUrl');
assertUrl(metadata.supportUrl, 'supportUrl');
assertUrl(metadata.privacyPolicyUrl, 'privacyPolicyUrl');
assert(metadata.supportUrl.endsWith('/support.html'), 'supportUrl must point to /support.html');
assert(metadata.privacyPolicyUrl.endsWith('/privacy.html'), 'privacyPolicyUrl must point to /privacy.html');

assert(metadata.reviewNotes && typeof metadata.reviewNotes === 'object', 'reviewNotes must be present');
assertIncludes('mobile/config/store-metadata.json', [
  'reviewer field-worker account',
  'https://arbor-os-b7k6.onrender.com/api',
  'Camera and photo access document jobs',
  'Location supports crew scheduling',
  'Push notifications deliver operational job updates',
]);

assert(metadata.privacyLabels && typeof metadata.privacyLabels === 'object', 'privacyLabels must be present');
for (const key of ['location', 'photos', 'userIdentifiers', 'diagnostics']) {
  assert(typeof metadata.privacyLabels[key] === 'string' && metadata.privacyLabels[key].length > 20, `privacyLabels.${key} must be documented`);
}

const manualGates = new Set(metadata.manualGates || []);
for (const gate of [
  'legal-review',
  'reviewer-test-account',
  'store-screenshots',
  'real-device-qa',
  'privacy-label-owner-approval',
  'production-crash-monitoring-confirmed',
]) {
  assert(manualGates.has(gate), `manualGates must include ${gate}`);
}
assert(metadata.legalReviewRequired === true, 'legalReviewRequired must remain true until owner/legal review is recorded');

assertIncludes('web/public/support.html', [
  'Arbor Mobile Support',
  'Last updated: 2026-06-20',
  'field-worker permissions',
  'Store Review',
  'Production support ownership must be confirmed before store submission',
]);

assertIncludes('web/public/privacy.html', [
  'Arbor Mobile Privacy Notice',
  'Last updated: 2026-06-20',
  'reviewed by the product owner and legal/privacy owner',
  'Account identifiers',
  'Photos, camera captures',
  'Location information',
  'Diagnostics, crash reports',
  'Retention And Deletion',
]);

assertIncludes('mobile/docs/mobile-store-readiness-checklist.md', [
  'npm run release:store-check',
  'mobile/config/store-metadata.json',
  'https://arbo-os.com/support.html',
  'https://arbo-os.com/privacy.html',
  'legal/privacy owner',
]);

assertIncludes('mobile/docs/mobile-release-runbook.md', [
  'npm run release:store-check',
  'store metadata',
]);

assertIncludes('mobile/package.json', [
  'release:store-check',
  '../scripts/mobile-store-readiness-check.cjs',
]);

assertIncludes('package.json', [
  'verify:mobile-store-readiness',
]);

console.log('mobile store readiness check passed');
