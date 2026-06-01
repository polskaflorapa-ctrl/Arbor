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

assertIncludes('docs/RESOURCE-CALENDAR-DRAG-DROP-CONTRACT.md', [
  '#/kalendarz-zasobow',
  'PATCH /api/tasks/:id/plan',
  'TASK_PLAN_CONFLICT',
  'TASK_CLIENT_TIME_WINDOW_CONFLICT',
  'GO',
  'NO-GO',
]);

assertIncludes('web/src/pages/KalendarzZasobow.js', [
  'planDateTimeForSlot',
  'buildPlanWarnings(tasks, task',
  'Konflikt terminu:',
  'api.patch(`/tasks/${task.id}/plan`',
  'godzina_rozpoczecia: nextTime',
  'absence_override: absenceOverride',
  'data-testid={`team-slot-${team.id}-${dayISO}-${slotTime}`}',
]);

assertIncludes('web/src/pages/KalendarzZasobow.test.js', [
  'requires confirmation before dragging a task onto an absent team',
  'blocks drag and drop when the target team slot already has a task',
  "expect(api.patch).not.toHaveBeenCalled()",
  "'/tasks/43/plan'",
]);

assertIncludes('os/src/routes/tasks.js', [
  "router.patch(",
  "'/:id/plan'",
  'godzina_rozpoczecia = COALESCE($5::time, godzina_rozpoczecia)',
  'TASK_PLAN_CONFLICT',
  'TASK_CLIENT_TIME_WINDOW_CONFLICT',
  'UPDATE equipment_reservations',
]);

assertIncludes('os/tests/tasks.test.js', [
  'updates planned datetime, start hour and team via PATCH /tasks/:id/plan for DnD',
  'returns 409 when PATCH /tasks/:id/plan conflicts with another task on the same team',
  'blocks PATCH /tasks/:id/plan outside accepted client window',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:resource-calendar-dnd',
  'RESOURCE-CALENDAR-DRAG-DROP-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'resource calendar drag & drop',
  'verify:resource-calendar-dnd',
  '**3.2**',
]);

assertIncludes('package.json', [
  'verify:resource-calendar-dnd',
]);

console.log('resource calendar drag & drop contract check passed');
