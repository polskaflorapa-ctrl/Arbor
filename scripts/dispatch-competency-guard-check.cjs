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

assertIncludes('docs/DISPATCH-COMPETENCY-GUARD-CONTRACT.md', [
  'POST /api/dispatch/apply/:id',
  'TEAM_COMPETENCY_BLOCKED',
  'blocked_assignments',
  'missing_competencies',
  'GO',
  'NO-GO',
]);

assertIncludes('os/src/routes/dispatch.js', [
  'findCompetencyBlockedAssignments',
  'WITH assignments',
  'TEAM_COMPETENCY_BLOCKED',
  'blocked_assignments',
  'missing_competencies',
  'uc.data_waznosci IS NULL OR uc.data_waznosci >= CURRENT_DATE',
  'UPDATE tasks SET ekipa_id',
]);

assertIncludes('os/tests/dispatch.test.js', [
  'lacks required competencies',
  'TEAM_COMPETENCY_BLOCKED',
  'blocked_assignments',
  'uc.data_waznosci IS NULL OR uc.data_waznosci >= CURRENT_DATE',
]);

assertIncludes('web/src/pages/AutoDispatch.js', [
  'TEAM_COMPETENCY_BLOCKED',
  'blocked_assignments',
  'missing_competencies',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:dispatch-competency-guard',
  'DISPATCH-COMPETENCY-GUARD-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'dispatch competency guard',
  'verify:dispatch-competency-guard',
  '**7.4**',
]);

assertIncludes('package.json', [
  'verify:dispatch-competency-guard',
]);

console.log('dispatch competency guard contract check passed');
