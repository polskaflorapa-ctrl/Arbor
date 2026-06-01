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

assertIncludes('docs/WORKLOG-TIMESHEET-CONTRACT.md', [
  'GET /api/payroll/worklog-timesheet?month=YYYY-MM',
  'source: work_logs',
  'hours_overtime',
  'weryfikacji prawnej',
  'GO',
  'NO-GO',
]);

assertIncludes('os/src/routes/payroll.js', [
  "router.get('/worklog-timesheet'",
  'worklogTimesheetQuerySchema',
  'FROM work_logs wl',
  'hours_overtime',
  'source: \'work_logs\'',
  'weryfikacji prawnej',
]);

assertIncludes('os/src/services/payrollTeamDay.js', [
  'buildTeamDayReport',
  'work_logs',
  'hours_overtime',
  'PAYROLL_OVERTIME_MULT',
]);

assertIncludes('os/tests/payroll-worklog-timesheet.test.js', [
  'builds manager scoped ECP from work_logs with overtime summary',
  'allows director to filter ECP by team without branch clamp',
  'blocks field team roles from management ECP endpoint',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:worklog-timesheet',
  'WORKLOG-TIMESHEET-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'worklog timesheet',
  'verify:worklog-timesheet',
  '**7.1**',
]);

assertIncludes('package.json', [
  'verify:worklog-timesheet',
]);

console.log('worklog timesheet contract check passed');
