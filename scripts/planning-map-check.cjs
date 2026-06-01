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

assertIncludes('docs/PLANNING-MAP-CONTRACT.md', [
  '#/mapa-live',
  'GET /api/tasks/wszystkie',
  'GET /api/ekipy/live-locations',
  '#/kalendarz-zasobow?date=YYYY-MM-DD&task=ID&modal=1',
  'GO',
  'NO-GO',
]);

assertIncludes('web/src/pages/MapaLive.js', [
  'planningCalendarPath',
  'taskMapPoint',
  'pointPosition(point, bounds)',
  'data-testid={`planning-task-pin-${task.id}`}',
  'data-testid={`planning-live-pin-${row.provider}-${row.ekipa_id || row.user_id || row.vehicle_id || index}`}',
  'onOpenSchedule={(task) => navigate(planningCalendarPath(task))}',
  'routeLines.map',
  'Kalendarz zasobow',
]);

assertIncludes('web/src/pages/MapaLive.test.js', [
  'renders planning task pins, live team pins, and opens resource calendar for a task',
  'planning-task-pin-102',
  'planning-live-pin-mobile-5',
  'task=102',
  'modal=1',
]);

assertIncludes('os/src/routes/ekipy.js', [
  "router.get('/live-locations'",
  'getLiveTeamLocations',
  'scopedOddzialId',
]);

assertIncludes('os/tests/juwentus-gps-live.test.js', [
  'returns source metadata for vehicle and mobile GPS rows',
  'provider: \'mobile\'',
  'gps_source_kind',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:planning-map',
  'PLANNING-MAP-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'planning map contract',
  'verify:planning-map',
  '**3.3**',
]);

assertIncludes('package.json', [
  'verify:planning-map',
]);

console.log('planning map contract check passed');
