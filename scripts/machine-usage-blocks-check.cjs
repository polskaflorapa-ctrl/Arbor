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

assertIncludes('docs/MACHINE-USAGE-BLOCKS-CONTRACT.md', [
  '#/flota',
  'POST /api/flota/rezerwacje',
  'PATCH /api/flota/rezerwacje/:id',
  'sprzet_przeglad_po_terminie',
  'sprzet_niedostepny',
  'GO',
  'NO-GO',
]);

assertIncludes('os/src/routes/flota.js', [
  'equipmentUsageBlock',
  'sprzet_przeglad_po_terminie',
  'sprzet_niedostepny',
  'inspectionDate && inspectionDate < usageStartDate',
  'SELECT id, oddzial_id, status, data_przegladu FROM equipment_items',
  'SELECT r.sprzet_id, e.status, e.data_przegladu',
]);

assertIncludes('os/tests/flota-rezerwacje.test.js', [
  'POST blocks equipment reservation after inspection deadline',
  'POST blocks equipment reservation when equipment is unavailable',
  'PATCH blocks moving reservation after inspection deadline',
  'sprzet_przeglad_po_terminie',
  'sprzet_niedostepny',
]);

assertIncludes('web/src/pages/Flota.js', [
  'blocked:',
  'BLOKADA',
  'Blokuje uzycie',
  'koszt_motogodziny',
]);

assertIncludes('web/src/pages/Flota.test.js', [
  'BLOKADA',
  'Blokuje uzycie',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:machine-usage-blocks',
  'MACHINE-USAGE-BLOCKS-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'machine usage blocks',
  'verify:machine-usage-blocks',
  '**6.2**',
]);

assertIncludes('package.json', [
  'verify:machine-usage-blocks',
]);

console.log('machine usage blocks contract check passed');
