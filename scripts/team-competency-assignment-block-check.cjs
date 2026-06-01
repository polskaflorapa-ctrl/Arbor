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

assertIncludes('docs/TEAM-COMPETENCY-ASSIGNMENT-BLOCK-CONTRACT.md', [
  'TEAM_COMPETENCY_MISSING',
  'tasks.wymagane_kompetencje',
  'user_competencies',
  'team_members',
  'PATCH /api/tasks/:id/plan',
  'POST /api/dispatch/apply/:id',
  'GO',
  'NO-GO',
]);

assertIncludes('os/src/services/taskCompetencies.js', [
  'assertTeamCompetenciesForTask',
  'TEAM_COMPETENCY_MISSING',
  'data_waznosci IS NULL OR uc.data_waznosci >= $2::date',
  'missing_competencies',
]);

assertIncludes('os/src/routes/tasks.js', [
  'assertTeamCompetenciesForTask',
  'sendCompetencyBlock',
  'TEAM_COMPETENCY_MISSING',
  "router.patch(\n  '/:id/plan'",
  "router.put('/:id/office-plan'",
  "router.put('/:id/przypisz'",
]);

assertIncludes('os/src/routes/dispatch.js', [
  'assertTeamCompetenciesForTask',
  'competencyBlockResponse',
  'TEAM_COMPETENCY_MISSING',
  "UPDATE tasks SET ekipa_id = $1",
]);

assertIncludes('os/tests/tasks.test.js', [
  'blocks PATCH /tasks/:id/plan when assigned team lacks required competency',
  'TEAM_COMPETENCY_MISSING',
  "missing_competencies: ['SEP']",
]);

assertIncludes('os/tests/dispatch.test.js', [
  '409 when applying a saved plan with missing team competency',
  'TEAM_COMPETENCY_MISSING',
  "not.toHaveBeenCalledWith('BEGIN')",
]);

assertIncludes('web/src/utils/apiError.js', [
  'TEAM_COMPETENCY_MISSING',
  'missing_competencies',
  'Ekipa nie ma wymaganych kompetencji',
]);

assertIncludes('web/src/pages/Kierownik.js', [
  'getApiErrorMessage(err',
  'TEAM_ABSENT',
]);

assertIncludes('web/src/pages/AutoplanDnia.js', [
  'TEAM_COMPETENCY_MISSING',
  'competencyBlocked',
  'Blokady kompetencji',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:team-competency-assignment-block',
  'TEAM-COMPETENCY-ASSIGNMENT-BLOCK-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'team competency assignment block',
  'verify:team-competency-assignment-block',
  '**7.3**',
]);

assertIncludes('package.json', [
  'verify:team-competency-assignment-block',
]);

console.log('team competency assignment block contract check passed');
