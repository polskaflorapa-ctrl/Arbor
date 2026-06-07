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

assertIncludes('docs/FLEET-REPAIR-DUE-CONTROLS-CONTRACT.md', [
  '#/flota?tab=naprawy',
  'termin_odbioru',
  'data_zakonczenia',
  'strata_dzienna',
  'priorytet',
  'Po terminie',
  'POST /api/flota/naprawy',
  'GO',
  'NO-GO',
]);

assertIncludes('os/migrate.sql', [
  'termin_odbioru DATE',
  'data_zakonczenia DATE',
  'strata_dzienna NUMERIC(10,2) DEFAULT 0',
  "priorytet     VARCHAR(80) DEFAULT 'Normalny'",
  'ALTER TABLE repairs ADD COLUMN IF NOT EXISTS termin_odbioru DATE',
  'ALTER TABLE repairs ADD COLUMN IF NOT EXISTS data_zakonczenia DATE',
  'ALTER TABLE repairs ADD COLUMN IF NOT EXISTS strata_dzienna NUMERIC(10,2) DEFAULT 0',
  'ALTER TABLE repairs ADD COLUMN IF NOT EXISTS priorytet VARCHAR(80) DEFAULT',
]);

assertIncludes('os/src/routes/flota.js', [
  'termin_odbioru: z.string().max(20).optional().nullable()',
  'data_zakonczenia: z.string().max(20).optional().nullable()',
  'strata_dzienna: z.coerce.number().optional().nullable()',
  'priorytet: z.string().trim().max(80).optional().nullable()',
  'termin_odbioru, data_zakonczenia, strata_dzienna, priorytet, status, oddzial_id',
  'termin_odbioru, data_zakonczenia, strata_dzienna, priorytet, status, user_id',
  "next.termin_odbioru || null",
  "next.data_zakonczenia || null",
  'next.strata_dzienna ?? null',
  "next.priorytet || 'Normalny'",
]);

assertIncludes('web/server/routes/fullStack.js', [
  'termin_odbioru: b.termin_odbioru || null',
  'data_zakonczenia: b.data_zakonczenia || null',
  'strata_dzienna: toNum(b.strata_dzienna)',
  "priorytet: b.priorytet ? String(b.priorytet).trim().slice(0, 80) : 'Normalny'",
  "repair.priorytet || 'Normalny'",
]);

assertIncludes('web/src/pages/Flota.js', [
  'REPAIR_PRIORITY_OPTIONS',
  'function repairDueState',
  'function repairDowntimeDays',
  'function repairDowntimeLoss',
  "state === 'overdue'",
  "state === 'soon'",
  "label: 'Po terminie'",
  'summary.overdueCount',
  'summary.soonCount',
  'summary.downtimeLoss',
  'strata_przestoju',
  'termin_status',
  'setField(\'termin_odbioru\'',
  'setField(\'data_zakonczenia\'',
  'setField(\'strata_dzienna\'',
  'setField(\'priorytet\'',
]);

assertIncludes('os/tests/flota-crud.test.js', [
  "termin_odbioru: '2026-06-03'",
  "data_zakonczenia: '2026-06-04'",
  'strata_dzienna: 450',
  "priorytet: 'Pilny'",
  "expect.stringContaining('termin_odbioru, data_zakonczenia, strata_dzienna, priorytet')",
]);

assertIncludes('web/src/pages/Flota.test.js', [
  'opens repairs tab from fleet deep link',
  'closes an open repair from fleet repairs tab',
  'filters overdue open repairs',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:fleet-repair-due-controls',
  'FLEET-REPAIR-DUE-CONTROLS-CONTRACT.md',
]);

assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', [
  'fleet repair due controls',
  'verify:fleet-repair-due-controls',
]);

assertIncludes('package.json', [
  'verify:fleet-repair-due-controls',
]);

console.log('fleet repair due controls contract check passed');
