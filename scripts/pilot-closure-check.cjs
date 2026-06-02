const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function readJson(file) {
  return JSON.parse(read(file));
}

function assertIncludes(file, needles) {
  const text = read(file);
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length) throw new Error(`${file} missing: ${missing.join(', ')}`);
}

function assertFiles(files) {
  const missing = files.filter((file) => !fs.existsSync(path.join(root, file)));
  if (missing.length) throw new Error(`Missing pilot closure files: ${missing.join(', ')}`);
}

function assertPackageScripts(file, scripts) {
  const pkg = readJson(file);
  const missing = scripts.filter((script) => !pkg.scripts || !pkg.scripts[script]);
  if (missing.length) throw new Error(`${file} missing scripts: ${missing.join(', ')}`);
}

assertFiles([
  'docs/PILOT-CLOSURE-GO-LIVE-GATE.md',
  'docs/PILOT-ONE-BRANCH-CHECKLIST.md',
  'docs/PILOT-HARDENING-KIEROWNIK-BRYGADZISTA.md',
  'docs/RBAC-BRANCH-SCOPE-AUDIT.md',
  'docs/KOMMO-IDEMPOTENCY-RETRY-DEADLETTER-CONTRACT.md',
  'docs/KOMMO-SMS-INCIDENT-DRILL.md',
  'docs/BACKUP-RPO-RTO-RUNBOOK.md',
  'docs/OBSERVABILITY-SLO-RUNBOOK.md',
  'docs/WEB-TTI-SMOKE-RUNBOOK.md',
]);

assertPackageScripts('package.json', [
  'status:json:strict',
  'check',
  'verify:pilot-closure',
  'verify:pilot-hardening',
  'verify:rbac-scope',
  'verify:kommo-idempotency-retry',
  'verify:kommo-sms-drill',
  'verify:backup-rpo',
  'verify:observability',
  'verify:web-tti',
  'smoke:critical-path',
  'smoke:operational',
  'smoke:demo:e2e',
  'smoke:p95',
  'smoke:web:tti',
  'deploy:prod:dry-run',
]);

assertPackageScripts('os/package.json', [
  'smoke:field',
  'smoke:office',
  'smoke:operational',
]);

assertPackageScripts('mobile/package.json', [
  'smoke:mobile',
  'test:offline-queue',
]);

assertPackageScripts('web/package.json', [
  'smoke:routes',
  'smoke:demo:e2e',
]);

assertIncludes('docs/PILOT-CLOSURE-GO-LIVE-GATE.md', [
  'npm run status:json:strict',
  'npm run verify:pilot-closure',
  'npm run check',
  'npm run smoke:critical-path',
  'npm run smoke:operational',
  'npm run smoke:demo:e2e',
  'npm run smoke:p95',
  'npm run smoke:web:tti',
  'Kierownik',
  'Brygadzista',
  'Kommo',
  'SMS',
  'backup',
  'offline',
  'GO',
  'NO-GO',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:pilot-closure',
  'PILOT-CLOSURE-GO-LIVE-GATE.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'pilot closure go-live gate',
  'verify:pilot-closure',
]);

console.log('pilot closure go-live gate check passed');
