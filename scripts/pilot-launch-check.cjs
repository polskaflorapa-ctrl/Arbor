const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function readJson(file) {
  return JSON.parse(read(file));
}

function assertFiles(files) {
  const missing = files.filter((file) => !fs.existsSync(path.join(root, file)));
  if (missing.length) throw new Error(`Missing pilot launch files: ${missing.join(', ')}`);
}

function assertIncludes(file, needles) {
  const text = read(file);
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length) throw new Error(`${file} missing: ${missing.join(', ')}`);
}

function assertPackageScripts(file, scripts) {
  const pkg = readJson(file);
  const missing = scripts.filter((script) => !pkg.scripts || !pkg.scripts[script]);
  if (missing.length) throw new Error(`${file} missing scripts: ${missing.join(', ')}`);
}

assertFiles([
  'docs/PILOT-LAUNCH-INDEX.md',
  'docs/PILOT-CLOSURE-GO-LIVE-GATE.md',
  'docs/PILOT-GO-NO-GO-DECISION-TEMPLATE.md',
  'docs/PILOT-ONE-BRANCH-CHECKLIST.md',
  'scripts/prepare-pilot-run.cjs',
  'scripts/run-pilot-gates.cjs',
]);

assertPackageScripts('package.json', [
  'verify:pilot-launch',
  'verify:pilot-execution',
  'verify:pilot-closure',
  'pilot:run:prepare',
  'pilot:gates:run',
  'verify:scripts',
  'smoke:p95',
  'smoke:web:tti',
]);

assertIncludes('docs/PILOT-LAUNCH-INDEX.md', [
  '#39',
  '#40',
  '#41',
  '#42',
  '#43',
  '#44',
  'npm run verify:pilot-launch',
  'npm run pilot:run:prepare -- --date YYYY-MM-DD',
  'npm run pilot:gates:run -- --date YYYY-MM-DD --continue-on-fail',
  'npm run pilot:gates:run -- --date YYYY-MM-DD --full --continue-on-fail',
  'PILOT-GO-NO-GO-YYYY-MM-DD.md',
  'PILOT-AUTOMATED-GATES-YYYY-MM-DD.md',
  'Arbor OS URL',
  'Arbor Web URL',
  'minimum 3 zlecenia',
  'Manualny A-Z',
  'GO',
  'NO-GO',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:pilot-launch',
  'PILOT-LAUNCH-INDEX.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'pilot launch index',
  'verify:pilot-launch',
]);

console.log('pilot launch index check passed');
