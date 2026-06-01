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

assertIncludes('docs/MOBILE-INVENTORY-USAGE-CONTRACT.md', [
  'zuzyte_materialy[].material_id',
  'inventory_materials',
  'inventory_movements',
  'stan_magazynu_za_maly',
  'GO',
  'NO-GO',
]);

assertIncludes('os/src/routes/tasks.js', [
  'material_id: z.coerce.number().int().positive().optional().nullable()',
  'const materialId = row.material_id',
  'UPDATE inventory_materials',
  'INSERT INTO inventory_movements',
  'TASK_FINISH_INVENTORY_STOCK_TOO_LOW',
  'TASK_FINISH_INVENTORY_TABLE_MISSING',
  'stan_magazynu_za_maly',
]);

assertIncludes('os/tests/tasks.test.js', [
  'POST /tasks/:id/finish posts inventory movement when material_id is provided',
  'POST /tasks/:id/finish blocks inventory issue without enough stock',
  'UPDATE inventory_materials',
  'INSERT INTO inventory_movements',
  'stan_magazynu_za_maly',
]);

assertIncludes('web/src/pages/ZlecenieDetail.js', [
  'finishInventoryMaterials',
  'finishUsageMaterialId',
  '/magazyn/materialy',
  'material_id: usageMaterialId',
  'Material spoza magazynu',
]);

assertIncludes('mobile/utils/zlecenie-detail.ts', [
  'material_id?: number',
  'materialId?: unknown',
  'material_id: parsedMaterialId',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:mobile-inventory-usage',
  'MOBILE-INVENTORY-USAGE-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'mobile inventory usage',
  'verify:mobile-inventory-usage',
  '**6.4**',
]);

assertIncludes('package.json', [
  'verify:mobile-inventory-usage',
]);

console.log('mobile inventory usage contract check passed');
