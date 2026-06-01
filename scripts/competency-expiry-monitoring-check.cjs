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

assertIncludes('docs/COMPETENCY-EXPIRY-MONITORING-CONTRACT.md', [
  'GET /api/hr/position-cards',
  'GET /api/hr/competency-expiry?days=90',
  'user_competencies',
  'expired_competencies_count',
  'competency_status',
  'GO',
  'NO-GO',
]);

assertIncludes('os/src/routes/hr.js', [
  'expired_competencies_count',
  'expiring_competencies_count',
  'nearest_competency_expiry',
  'competency_status',
  'source:           \'user_competencies\'',
]);

assertIncludes('os/tests/hr.test.js', [
  'expired_competencies_count',
  'expiring_competencies_count',
  'adds status and source for expiring competency alerts',
  'source: \'user_competencies\'',
]);

assertIncludes('web/src/pages/KadryDokumenty.js', [
  '/hr/competency-expiry?days=90',
  'competencyAlerts',
  'expired_competencies_count',
  'nearest_competency_expiry',
  'Uprawnienia',
]);

assertIncludes('web/src/pages/Uzytkownicy.js', [
  'data_waznosci',
  'DO ODNOWIENIA',
  'WYGAS',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:competency-expiry-monitoring',
  'COMPETENCY-EXPIRY-MONITORING-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'competency expiry monitoring',
  'verify:competency-expiry-monitoring',
  '**7.2**',
]);

assertIncludes('package.json', [
  'verify:competency-expiry-monitoring',
]);

console.log('competency expiry monitoring contract check passed');
