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

assertIncludes('docs/MATERIAL-INVENTORY-CONTRACT.md', [
  '#/magazyn',
  '/api/magazyn/materialy',
  '/api/magazyn/ruchy',
  'stan_magazynu_za_maly',
  'inventory_materials',
  'inventory_movements',
  'GO',
  'NO-GO',
]);

assertIncludes('os/migrate.sql', [
  'CREATE TABLE IF NOT EXISTS inventory_materials',
  'CREATE TABLE IF NOT EXISTS inventory_movements',
  'idx_inventory_movements_task',
]);

assertIncludes('os/src/app.js', [
  "const magazynRoutes = require('./routes/magazyn')",
  "app.use('/api/magazyn', magazynRoutes)",
]);

assertIncludes('os/src/routes/magazyn.js', [
  "router.get('/materialy'",
  "router.post('/materialy'",
  "router.post('/ruchy'",
  'task_wymagany_dla_rozchodu',
  'stan_magazynu_za_maly',
  'inventory_materials',
  'inventory_movements',
  'scopedBranch',
]);

assertIncludes('os/tests/magazyn.test.js', [
  'Magazyn materialow',
  'GET /materialy scopes manager to own branch',
  'POST /ruchy records receipt and increases stock',
  'POST /ruchy records task issue and decreases stock',
  'POST /ruchy blocks issue without enough stock',
]);

assertIncludes('web/src/pages/MagazynWeb.js', [
  '/magazyn/materialy',
  '/magazyn/ruchy',
  'Magazyn materialow',
  'Nowy material',
  'Ruch magazynowy',
  'Rozchod na zlecenie',
  'Niski stan',
]);

assertIncludes('web/src/pages/MagazynWeb.test.js', [
  'renders material inventory and saves material receipt and task issue',
  '/magazyn/materialy',
  '/magazyn/ruchy',
  'Rozchod na zlecenie',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:material-inventory',
  'MATERIAL-INVENTORY-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'material inventory',
  'verify:material-inventory',
  '**6.3**',
]);

assertIncludes('package.json', [
  'verify:material-inventory',
]);

console.log('material inventory contract check passed');
