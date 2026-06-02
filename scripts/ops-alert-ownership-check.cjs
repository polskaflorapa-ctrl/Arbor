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

assertIncludes('docs/OPS-ALERT-OWNERSHIP-CONTRACT.md', [
  'kommo_sync',
  'owner_role',
  'owner_label',
  'ops_action_events',
  'P1',
  'P2',
  'GO',
  'NO-GO',
]);

assertIncludes('os/src/routes/ops.js', [
  'RISK_OWNER_META',
  'owner_role',
  'owner_label',
  'kommo_sync',
  'task_kommo_sync_queue',
  'kommo_sync_risks',
  'risk_acknowledge',
  'ops_action_events',
]);

assertIncludes('web/src/pages/Kierownik.js', [
  'Kommo',
  'risk.owner_label',
  'risk.escalation',
  'acknowledge',
  'Potwierdz',
]);

assertIncludes('docs/OBSERVABILITY-SLO-RUNBOOK.md', [
  'P1',
  'P2',
  'wlasciciela',
]);

assertIncludes('docs/PRODUCTION-INCIDENT-RUNBOOK.md', [
  'owner',
  'severity',
  'P1',
  'dead_letter',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:ops-alert-ownership',
  'OPS-ALERT-OWNERSHIP-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'ops alert ownership',
  'verify:ops-alert-ownership',
  '**9.5**',
]);

assertIncludes('package.json', [
  'verify:ops-alert-ownership',
]);

console.log('ops alert ownership contract check passed');
