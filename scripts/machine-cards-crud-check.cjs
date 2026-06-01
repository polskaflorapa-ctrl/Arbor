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

assertIncludes('docs/MACHINE-CARDS-CRUD-CONTRACT.md', [
  '#/flota',
  'PUT /api/flota/sprzet/:id',
  'DELETE /api/flota/sprzet/:id',
  'PUT /api/flota/pojazdy/:id',
  'DELETE /api/flota/pojazdy/:id',
  'oddzial_id',
  'GO',
  'NO-GO',
]);

assertIncludes('os/src/routes/flota.js', [
  'getFleetResource',
  'canAccessFleetResource',
  'fleetBranchForWrite',
  "router.put('/sprzet/:id'",
  "router.delete('/sprzet/:id'",
  "router.put('/pojazdy/:id'",
  "router.delete('/pojazdy/:id'",
  'UPDATE equipment_items',
  'DELETE FROM equipment_items',
]);

assertIncludes('web/src/pages/Flota.js', [
  'editingSprzetId',
  'editingPojazdId',
  'startEditSprzet',
  'startEditPojazd',
  'deleteFleetItem',
  "api.put(`/flota/sprzet/${editingSprzetId}`",
  "api.delete(`/flota/${type}/${id}`",
  'Zapisz sprzet',
  'Edytuj',
  'Usun',
]);

assertIncludes('web/src/pages/Flota.test.js', [
  'edits and deletes equipment from fleet cards CRUD flow',
  '/flota/sprzet/11',
  'Zapisz sprzet',
  'api.delete',
]);

assertIncludes('os/tests/flota-crud.test.js', [
  'updates an equipment card in manager branch scope',
  'blocks manager update outside own branch',
  'updates and deletes a vehicle card',
  'UPDATE equipment_items',
  'DELETE FROM vehicles',
]);

assertIncludes('os/tests/flota-crud.test.js', [
  'Flota CRUD kart zasobow',
  'updates an equipment card in manager branch scope',
  'updates and deletes a vehicle card',
  'UPDATE vehicles',
  'DELETE FROM vehicles',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:machine-cards-crud',
  'MACHINE-CARDS-CRUD-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'machine cards CRUD',
  'verify:machine-cards-crud',
  '**6.1**',
]);

assertIncludes('package.json', [
  'verify:machine-cards-crud',
]);

console.log('machine cards CRUD contract check passed');
