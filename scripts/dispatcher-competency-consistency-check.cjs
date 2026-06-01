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

assertIncludes('docs/DISPATCHER-COMPETENCY-CONSISTENCY-CONTRACT.md', [
  'TEAM_COMPETENCY_MISSING',
  'tasks.wymagane_kompetencje',
  'user_competencies',
  'data_waznosci IS NULL',
  'missing_competencies',
  'AutoDispatch',
  'GO',
  'NO-GO',
]);

assertIncludes('docs/TEAM-COMPETENCY-ASSIGNMENT-BLOCK-CONTRACT.md', [
  'TEAM_COMPETENCY_MISSING',
  'POST /api/dispatch/apply/:id',
]);

assertIncludes('os/src/routes/dispatch.js', [
  'uc.data_waznosci IS NULL OR uc.data_waznosci >= $1::date',
  'assertTeamCompetenciesForTask',
  'TEAM_COMPETENCY_MISSING',
  'missing_competencies',
]);

assertIncludes('os/src/services/vrp.js', [
  'no_capable_team',
  'missing_competencies',
  'Brakuje kompetencji',
]);

assertIncludes('os/tests/dispatch.test.js', [
  'uc.data_waznosci IS NULL OR uc.data_waznosci >= $1::date',
  '409 when applying a saved plan with missing team competency',
  'TEAM_COMPETENCY_MISSING',
]);

assertIncludes('os/tests/vrp-unassigned-reasons.test.js', [
  'missing_competencies',
  'no_capable_team',
]);

assertIncludes('web/src/pages/AutoDispatch.js', [
  'TEAM_COMPETENCY_MISSING',
  'competency_block',
  'Blokada kompetencji',
  'getApiErrorMessage',
]);

assertIncludes('web/src/pages/Harmonogram.js', [
  'getApiErrorMessage(err)',
  '/dispatch/apply/${loadedDispatchPlan.id}',
]);

assertIncludes('web/src/pages/Kierownik.js', [
  'getApiErrorMessage(err, \'Nie udalo sie zastosowac planu dispatchera.\')',
  '/dispatch/apply/${planRow.id}',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:dispatcher-competency-consistency',
  'DISPATCHER-COMPETENCY-CONSISTENCY-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'dispatcher competency consistency',
  'verify:dispatcher-competency-consistency',
  '**7.4**',
]);

assertIncludes('package.json', [
  'verify:dispatcher-competency-consistency',
]);

console.log('dispatcher competency consistency contract check passed');
