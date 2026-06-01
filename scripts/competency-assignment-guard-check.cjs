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

assertIncludes('docs/COMPETENCY-ASSIGNMENT-GUARD-CONTRACT.md', [
  'PUT /api/tasks/:id/przypisz',
  'PUT /api/tasks/:id/office-plan',
  'TEAM_COMPETENCY_BLOCKED',
  'missing_competencies',
  'GO',
  'NO-GO',
]);

assertIncludes('os/src/routes/tasks.js', [
  'assertTeamHasRequiredCompetencies',
  'TEAM_COMPETENCY_BLOCKED',
  'missing_competencies',
  'required_competencies',
  'user_competencies',
  'team_members',
  'data_waznosci >= CURRENT_DATE',
]);

assertIncludes('os/tests/tasks.test.js', [
  'blocks teams without required competencies',
  'TEAM_COMPETENCY_BLOCKED',
  'missing_competencies',
  'wymagane_kompetencje',
]);

assertIncludes('web/src/utils/apiError.js', [
  'TEAM_COMPETENCY_BLOCKED',
  'missing_competencies',
  'Nie mozna przypisac ekipy bez wymaganych kompetencji',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:competency-assignment-guard',
  'COMPETENCY-ASSIGNMENT-GUARD-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'competency assignment guard',
  'verify:competency-assignment-guard',
  '**7.3**',
]);

assertIncludes('package.json', [
  'verify:competency-assignment-guard',
]);

console.log('competency assignment guard contract check passed');
