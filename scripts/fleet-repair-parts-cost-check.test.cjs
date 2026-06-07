const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertExcludes,
  runFleetRepairPartsCostCheck,
} = require('./fleet-repair-parts-cost-check.cjs');

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-repair-parts-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('fleet repair parts check keeps parts as a separate repair cost component', () => {
  withFixture((root) => {
    writeFixtureFile(
      root,
      'docs/FLEET-REPAIR-PARTS-COST-CONTRACT.md',
      'GET /api/flota/naprawy czesci_count czesci_kwota POST /api/flota/naprawy/:naprawaId/czesci Dodanie czesci nie zmienia `repair.koszt` GO NO-GO npm run verify:fleet-repair-parts-cost',
    );
    writeFixtureFile(
      root,
      'web/server/routes/fullStack.js',
      [
        'const repairParts = parts.filter((x) => Number(x.naprawa_id) === Number(repair.id));',
        'const czesci_kwota = repairParts.reduce((sum, x) => sum + (Number(x.kwota_laczna) || 0), 0);',
        'czesci_count: repairParts.length',
        'czesci_kwota,',
        's.flotaCzesciNapraw.push(part);',
      ].join('\n'),
    );
    writeFixtureFile(root, 'web/src/pages/Flota.js', 'Number(repair.czesci_kwota || 0) czesci_kwota czesci_count');
    writeFixtureFile(root, 'docs/PILOT-ONE-BRANCH-CHECKLIST.md', 'verify:fleet-repair-parts-cost FLEET-REPAIR-PARTS-COST-CONTRACT.md');
    writeFixtureFile(root, 'docs/ARBOR-full-scope-implementation-backlog.md', 'fleet repair parts cost verify:fleet-repair-parts-cost');

    assert.deepEqual(runFleetRepairPartsCostCheck(root), { ok: true });
  });
});

test('fleet repair parts check fails when adding a part mutates base repair cost', () => {
  withFixture((root) => {
    writeFixtureFile(
      root,
      'web/server/routes/fullStack.js',
      'repair.koszt = Math.max(currentCost, part.kwota_laczna);',
    );

    assert.throws(
      () => assertExcludes('web/server/routes/fullStack.js', ['repair.koszt = Math.max(currentCost, part.kwota_laczna);'], root),
      /should not include/,
    );
  });
});
