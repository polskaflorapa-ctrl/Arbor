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

assertIncludes('docs/EQUIPMENT-USAGE-RULES-CONTRACT.md', [
  'POST /api/flota/rezerwacje',
  'sprzet_przeglad_po_terminie',
  'EQUIPMENT_INSPECTION_OVERDUE',
  'przeglad_alert',
  'koszt_motogodziny',
  'GO',
  'NO-GO',
]);

assertIncludes('os/src/routes/flota.js', [
  'reservationInspectionBlock',
  'reservationStatusBlock',
  'sprzet_przeglad_po_terminie',
  'EQUIPMENT_INSPECTION_OVERDUE',
  'data_przegladu',
  'SELECT id, oddzial_id, nazwa, status, data_przegladu FROM equipment_items WHERE id = $1',
]);

assertIncludes('web/src/pages/RezerwacjeSprzetu.js', [
  'equipmentInspectionBlocked',
  'equipmentLabel',
  'sprzet_przeglad_po_terminie',
  'EQUIPMENT_INSPECTION_OVERDUE',
  'data-testid={`equipment-option-${s.id}`}',
]);

assertIncludes('os/tests/flota-rezerwacje.test.js', [
  'blocks equipment reservation when inspection expires before reservation end',
  'sprzet_przeglad_po_terminie',
  'EQUIPMENT_INSPECTION_OVERDUE',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:equipment-usage-rules',
  'EQUIPMENT-USAGE-RULES-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'equipment usage rules',
  'verify:equipment-usage-rules',
  '**6.2**',
]);

assertIncludes('package.json', [
  'verify:equipment-usage-rules',
]);

console.log('equipment usage rules contract check passed');
