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

assertIncludes('docs/DISPATCHER-DAY-PLAN-LOAD-CONTRACT.md', [
  '#/harmonogram?date=YYYY-MM-DD&view=dzien',
  'GET /api/dispatch/plans',
  'GET /api/dispatch/plans/:id',
  'POST /api/dispatch/apply/:id',
  'Wczytaj plan dispatchera',
  'GO',
  'NO-GO',
]);

assertIncludes('web/src/pages/Harmonogram.js', [
  'loadDispatcherDayPlan',
  "api.get('/dispatch/plans'",
  "api.get(`/dispatch/plans/${match.id}`",
  "api.post(`/dispatch/apply/${loadedDispatchPlan.id}`",
  'Wczytaj plan dispatchera',
  'harmonogram-dispatch-loaded-plan',
  'Plan zastosowany',
]);

assertIncludes('web/src/pages/Harmonogram.test.js', [
  'loads and applies a saved dispatcher day plan from the manager schedule',
  '/dispatch/plans',
  '/dispatch/plans/91',
  '/dispatch/apply/91',
  'harmonogram-dispatch-loaded-plan',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:dispatcher-day-plan',
  'DISPATCHER-DAY-PLAN-LOAD-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'dispatcher day plan load',
  'verify:dispatcher-day-plan',
  '**3.5**',
]);

assertIncludes('package.json', [
  'verify:dispatcher-day-plan',
]);

console.log('dispatcher day plan load contract check passed');
