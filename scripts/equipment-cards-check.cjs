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

assertIncludes('docs/EQUIPMENT-CARDS-CONTRACT.md', [
  '#/flota',
  'GET /api/flota/pojazdy',
  'GET /api/flota/sprzet',
  'data_przegladu',
  'data_ubezpieczenia',
  'koszt_motogodziny',
  '#/kalendarz-zasobow?tab=equipment&equipment=ID&modal=0',
  'GO',
  'NO-GO',
]);

assertIncludes('web/src/pages/Flota.js', [
  'ALERT_WINDOW_DAYS',
  'resourceCards',
  'resourceRiskCards',
  'Alerty zasobow',
  'dueAlert({ key: \'inspection\', label: \'Przeglad\' }',
  'dueAlert({ key: \'insurance\', label: \'OC\' }',
  'next_reservation_from',
  'data-testid={`fleet-resource-card-${card.id}`}',
  'data-testid={`fleet-alert-card-${card.id}-${alert.key}`}',
  "new URLSearchParams({ tab: 'equipment', modal: '0' })",
  'Kalendarz zasobow',
]);

assertIncludes('web/src/pages/Flota.test.js', [
  'renders resource cards with inspection, insurance, reservation alerts, and calendar handoff',
  'fleet-resource-card-vehicle-5',
  'fleet-alert-card-vehicle-5-insurance',
  'fleet-resource-card-equipment-11',
  'fleet-alert-card-equipment-11-inspection',
  'fleet-alert-card-equipment-11-reservation',
  'equipment=11',
]);

assertIncludes('os/src/routes/flota.js', [
  'AS przeglad_alert',
  'LEFT JOIN LATERAL',
  'next_reservation_from',
  'next_task_client',
]);

assertIncludes('os/tests/flota-rezerwacje.test.js', [
  'GET /sprzet returns inspection alert and next reservation context',
  'przeglad_alert',
  'next_reservation_from',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:equipment-cards',
  'EQUIPMENT-CARDS-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'equipment cards contract',
  'verify:equipment-cards',
  '**3.4**',
]);

assertIncludes('package.json', [
  'verify:equipment-cards',
]);

console.log('equipment cards contract check passed');
