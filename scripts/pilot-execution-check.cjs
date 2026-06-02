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
  if (missing.length) throw new Error(`Missing pilot execution files: ${missing.join(', ')}`);
}

function assertPackageScripts(file, scripts) {
  const pkg = readJson(file);
  const missing = scripts.filter((script) => !pkg.scripts || !pkg.scripts[script]);
  if (missing.length) throw new Error(`${file} missing scripts: ${missing.join(', ')}`);
}

assertFiles([
  'docs/PILOT-GO-NO-GO-DECISION-TEMPLATE.md',
  'docs/PILOT-CLOSURE-GO-LIVE-GATE.md',
  'docs/PILOT-ONE-BRANCH-CHECKLIST.md',
  'docs/pilot-runs/.gitkeep',
  'scripts/create-pilot-run-report.cjs',
  'scripts/run-pilot-gates.cjs',
  'scripts/pilot-run-tools.test.cjs',
]);

assertPackageScripts('package.json', [
  'verify:pilot-execution',
  'pilot:run:new',
  'pilot:gates:run',
  'verify:pilot-closure',
  'status:json:strict',
  'check',
  'smoke:critical-path',
  'smoke:operational',
  'smoke:demo:e2e',
  'smoke:p95',
  'smoke:web:tti',
]);

assertIncludes('docs/PILOT-GO-NO-GO-DECISION-TEMPLATE.md', [
  'Data:',
  'Srodowisko:',
  'Arbor OS URL:',
  'Arbor Web URL:',
  'Oddzial ID / nazwa:',
  'Zlecenia testowe ID:',
  'Wlasciciel decyzji:',
  'Automatyczne bramki:',
  'PASS',
  'FAIL',
  'SKIP',
  'EXCEPTION',
  'npm run status:json:strict',
  'npm run verify:pilot-closure',
  'npm run check',
  'npm run smoke:critical-path',
  'npm run smoke:operational',
  'npm run smoke:demo:e2e',
  'npm run smoke:p95',
  'npm run smoke:web:tti',
  'Manualny przebieg A-Z',
  'Wyjatki',
  'Wlasciciel',
  'Termin',
  'Decyzja: `GO` / `NO-GO`',
  'minimum 3 zleceniach',
]);

assertIncludes('scripts/create-pilot-run-report.cjs', [
  'PILOT-GO-NO-GO-DECISION-TEMPLATE.md',
  'defaultGatesReport',
  'docs',
  'pilot-runs',
  'PILOT-GO-NO-GO-',
  'PILOT-AUTOMATED-GATES-',
  '--date',
  '--force',
  '--gates-report',
  'YYYY-MM-DD',
]);

assertIncludes('scripts/run-pilot-gates.cjs', [
  'CORE_GATES',
  'FULL_GATES',
  'status:json:strict',
  'verify:pilot-closure',
  'verify:pilot-execution',
  'verify:pilot-hardening',
  'smoke:critical-path',
  'smoke:operational',
  'smoke:demo:e2e',
  '--dry-run',
  '--full',
  '--continue-on-fail',
  'PILOT-AUTOMATED-GATES-',
]);

assertIncludes('scripts/pilot-run-tools.test.cjs', [
  'createPilotRunReport',
  'parseReportArgs',
  'parseGateArgs',
  'runPilotGates',
  'writeReport',
  'PILOT-GO-NO-GO-2099-12-31.md',
  'PILOT-AUTOMATED-GATES-2099-12-31.md',
]);

assertIncludes('docs/PILOT-CLOSURE-GO-LIVE-GATE.md', [
  'PILOT-GO-NO-GO-DECISION-TEMPLATE.md',
  'docs/pilot-runs',
  'verify:pilot-execution',
  'pilot:run:new',
  'pilot:gates:run',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:pilot-execution',
  'PILOT-GO-NO-GO-DECISION-TEMPLATE.md',
  'pilot:run:new',
  'pilot:gates:run',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'pilot execution evidence template',
  'verify:pilot-execution',
  'pilot:run:new',
  'pilot:gates:run',
]);

console.log('pilot execution evidence template check passed');
