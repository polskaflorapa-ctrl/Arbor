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

assertIncludes('docs/WAREHOUSE-MOBILE-USAGE-INTEGRATION.md', [
  'POST /api/tasks/:id/finish',
  'zuzyte_materialy[].material_id',
  'warehouse_material_movements',
  'WAREHOUSE_STOCK_UNDERFLOW',
  'GO',
  'NO-GO',
]);

assertIncludes('os/migrate.sql', [
  'ALTER TABLE task_finish_material_usage ADD COLUMN IF NOT EXISTS material_id',
  'idx_task_finish_material_usage_material',
  'warehouse_materials',
  'warehouse_material_movements',
]);

assertIncludes('os/src/routes/tasks.js', [
  'material_id: z.coerce.number().int().positive().optional().nullable()',
  'insertWarehouseIssuesForFinish',
  'warehouse_material_movements',
  'WAREHOUSE_STOCK_UNDERFLOW',
  'Finish zlecenia #',
]);

assertIncludes('os/tests/tasks.test.js', [
  'creates warehouse issue for matching material usage',
  'rolls back when warehouse stock is too low',
  'WAREHOUSE_STOCK_UNDERFLOW',
  'INSERT INTO warehouse_material_movements',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:warehouse-mobile-usage',
  'WAREHOUSE-MOBILE-USAGE-INTEGRATION.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'warehouse mobile usage',
  'verify:warehouse-mobile-usage',
  '**6.4**',
]);

assertIncludes('package.json', [
  'verify:warehouse-mobile-usage',
]);

console.log('warehouse mobile usage integration check passed');
