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

assertIncludes('docs/RESOURCE-CALENDAR-WEEKLY-CONTRACT.md', [
  '#/kalendarz-zasobow',
  'GET /api/flota/rezerwacje?from=YYYY-MM-DD&to=YYYY-MM-DD',
  'krytyczny sprzet',
  'GO',
  'NO-GO',
]);

assertIncludes('web/src/App.js', [
  'path="/kalendarz-zasobow"',
  '<KalendarzZasobow />',
]);

assertIncludes('web/src/pages/KalendarzZasobow.js', [
  'const TEAM_ROW_H',
  'const DAY_TEAM_COL_W',
  'const [rangeLen, setRangeLen] = useState(14)',
  "setTeamViewMode('range')",
  "setActiveTab('equipment')",
  '`/flota/rezerwacje?from=${from}&to=${to}`',
  'dayReservationConflicts',
  'taskReservationEquipmentIds',
  'buildDayBrief',
  'copyTeamBrief',
  'absence_override',
  'data-testid={`team-slot-${team.id}-${dayISO}-${slotTime}`}',
]);

assertIncludes('web/src/pages/KalendarzZasobow.test.js', [
  'copies the dispatcher day brief with task, equipment, risk, and map context',
  'marks absent teams in dispatch planning and copied briefs',
  'renders the equipment week board with task-linked reservation context',
]);

assertIncludes('os/src/routes/flota.js', [
  "router.get('/rezerwacje'",
  'r.task_id, r.notatki',
  'task_klient_nazwa',
  'task_adres',
  "router.post('/rezerwacje'",
  "router.patch(",
  'rezerwacja_kolizja_sprzet',
]);

assertIncludes('os/tests/flota-rezerwacje.test.js', [
  'GET adds branch filter for non-Dyrektor',
  'POST returns 409 on overlapping active reservation',
  'POST can link reservation with task context',
  'PUT status applies branch filter for Kierownik',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:resource-calendar-week',
  'RESOURCE-CALENDAR-WEEKLY-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'resource calendar weekly contract',
  'verify:resource-calendar-week',
  '**3.1** Kalendarz zasob',
]);

assertIncludes('package.json', [
  'verify:resource-calendar-week',
]);

console.log('resource calendar weekly contract check passed');
