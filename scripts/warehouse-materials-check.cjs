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

assertIncludes('docs/WAREHOUSE-MATERIALS-CONTRACT.md', [
  'GET /api/magazyn/materialy',
  'POST /api/magazyn/przyjecia',
  'POST /api/magazyn/rozchody',
  'WAREHOUSE_STOCK_UNDERFLOW',
  'GO',
  'NO-GO',
]);

assertIncludes('os/migrate.sql', [
  'CREATE TABLE IF NOT EXISTS warehouse_materials',
  'CREATE TABLE IF NOT EXISTS warehouse_material_movements',
  'idx_warehouse_movements_task',
]);

assertIncludes('os/src/app.js', [
  "require('./routes/magazyn')",
  "app.use('/api/magazyn', magazynRoutes)",
]);

assertIncludes('os/src/routes/magazyn.js', [
  "router.get('/materialy'",
  "router.post('/materialy'",
  "router.post('/przyjecia'",
  "router.post('/rozchody'",
  'warehouse_material_movements',
  'WAREHOUSE_STOCK_UNDERFLOW',
  'scopedOddzialId',
]);

assertIncludes('web/src/pages/MagazynWeb.js', [
  '/magazyn/materialy',
  '/magazyn/${kind}',
  'Magazyn materialow',
  'Przyjecie',
  'Rozchod na zlecenie',
  'Niski stan',
]);

assertIncludes('os/tests/magazyn.test.js', [
  'lists branch materials with computed stock and low stock flag',
  'records a material receipt',
  'blocks task issue when stock would go negative',
  'WAREHOUSE_STOCK_UNDERFLOW',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:warehouse-materials',
  'WAREHOUSE-MATERIALS-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'warehouse materials',
  'verify:warehouse-materials',
  '**6.3**',
]);

assertIncludes('package.json', [
  'verify:warehouse-materials',
]);

console.log('warehouse materials contract check passed');
