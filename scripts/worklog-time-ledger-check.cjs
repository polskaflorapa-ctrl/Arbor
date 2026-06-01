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

assertIncludes('docs/WORKLOG-TIME-LEDGER-CONTRACT.md', [
  'GET /api/godziny/ecp',
  'work_logs',
  'nadgodziny',
  'legal_note',
  'daily_minutes_over_480',
  'GO',
  'NO-GO',
]);

assertIncludes('os/src/routes/godziny.js', [
  "router.get('/ecp'",
  'ecpQuerySchema',
  'ecpBranchScope',
  'FROM work_logs wl',
  'wl.end_time IS NOT NULL',
  "AT TIME ZONE 'Europe/Warsaw'",
  'GREATEST(SUM(minutes) - 480, 0)',
  'legal_note',
  'data_do_przed_data_od',
]);

assertIncludes('os/tests/godziny.test.js', [
  'Godziny ECP z work logow',
  'GET /ecp returns automatic work log ledger with overtime summary',
  'GET /ecp lets director request a specific branch and user',
  'GET /ecp rejects reversed date range',
  'daily_minutes_over_480',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:worklog-time-ledger',
  'WORKLOG-TIME-LEDGER-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'worklog time ledger',
  'verify:worklog-time-ledger',
  '**7.1**',
]);

assertIncludes('package.json', [
  'verify:worklog-time-ledger',
]);

console.log('worklog time ledger contract check passed');
