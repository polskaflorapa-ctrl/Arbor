const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(file, baseRoot = root) {
  return fs.readFileSync(path.join(baseRoot, file), 'utf8');
}

function assertIncludes(file, needles, baseRoot = root) {
  const text = read(file, baseRoot);
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length) throw new Error(`${file} missing: ${missing.join(', ')}`);
}

function assertExcludes(file, needles, baseRoot = root) {
  const text = read(file, baseRoot);
  const present = needles.filter((needle) => text.includes(needle));
  if (present.length) throw new Error(`${file} should not include: ${present.join(', ')}`);
}

function runFleetRepairPartsCostCheck(baseRoot = root) {
  assertIncludes('docs/FLEET-REPAIR-PARTS-COST-CONTRACT.md', [
    'GET /api/flota/naprawy',
    'czesci_count',
    'czesci_kwota',
    'POST /api/flota/naprawy/:naprawaId/czesci',
    'Dodanie czesci nie zmienia `repair.koszt`',
    'GO',
    'NO-GO',
    'npm run verify:fleet-repair-parts-cost',
  ], baseRoot);

  assertIncludes('web/server/routes/fullStack.js', [
    'const repairParts = parts.filter((x) => Number(x.naprawa_id) === Number(repair.id));',
    'const czesci_kwota = repairParts.reduce((sum, x) => sum + (Number(x.kwota_laczna) || 0), 0);',
    'czesci_count: repairParts.length',
    'czesci_kwota,',
    's.flotaCzesciNapraw.push(part);',
  ], baseRoot);

  assertExcludes('web/server/routes/fullStack.js', [
    'repair.koszt = Math.max(currentCost, part.kwota_laczna);',
  ], baseRoot);

  assertIncludes('web/src/pages/Flota.js', [
    'Number(repair.czesci_kwota || 0)',
    'czesci_kwota',
    'czesci_count',
  ], baseRoot);

  assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
    'verify:fleet-repair-parts-cost',
    'FLEET-REPAIR-PARTS-COST-CONTRACT.md',
  ], baseRoot);

  assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
    'fleet repair parts cost',
    'verify:fleet-repair-parts-cost',
  ], baseRoot);

  return { ok: true };
}

if (require.main === module) {
  runFleetRepairPartsCostCheck();
  console.log('fleet repair parts cost contract check passed');
}

module.exports = {
  assertExcludes,
  assertIncludes,
  runFleetRepairPartsCostCheck,
};
