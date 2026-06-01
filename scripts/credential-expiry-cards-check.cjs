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

assertIncludes('docs/CREDENTIAL-EXPIRY-CARDS-CONTRACT.md', [
  'GET /api/hr/position-cards',
  'credential_expired_count',
  'credential_expiring_count',
  'credential_status',
  'GET /api/hr/competency-expiry',
  'summary',
  'GO',
  'NO-GO',
]);

assertIncludes('os/src/routes/hr.js', [
  'credential_expired_count',
  'credential_expiring_count',
  'credential_next_expiry',
  'credential_status',
  'expiry_status',
  'summary',
  'user_competencies',
]);

assertIncludes('os/tests/hr.test.js', [
  'adds credential expiry status to employee cards',
  'summarizes expired and critical credentials',
  'credential_expired_count',
  'expiry_status',
]);

assertIncludes('web/src/pages/HrPanel.js', [
  'competencySummary',
  'setCompetencySummary',
  'r.data?.items',
  'Razem:',
  'Wygasle:',
  'expiry_status',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:credential-expiry-cards',
  'CREDENTIAL-EXPIRY-CARDS-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'credential expiry cards',
  'verify:credential-expiry-cards',
  '**7.2**',
]);

assertIncludes('package.json', [
  'verify:credential-expiry-cards',
]);

console.log('credential expiry cards contract check passed');
