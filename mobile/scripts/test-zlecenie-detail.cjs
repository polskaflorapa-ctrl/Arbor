const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'utils', 'zlecenie-detail.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: sourcePath,
}).outputText;

function localRequire(id) {
  if (id === '@expo/vector-icons') {
    return { Ionicons: {} };
  }
  if (id === '../constants/task-form') {
    return {
      TASK_SETTLEMENT_OPTIONS: [
        { key: 'fixed', label: 'Cena za zakres', note: 'Warunki rozliczenia: cena ryczaltowa.' },
      ],
    };
  }
  if (id.startsWith('../')) {
    return require(path.join(repoRoot, id.slice(3)));
  }
  return require(id);
}

const moduleRef = { exports: {} };
const fn = new Function('require', 'exports', 'module', compiled);
fn(localRequire, moduleRef.exports, moduleRef);

const {
  absolutePhotoUrl,
  buildFinishMaterialUsage,
  buildFinishOperationalCostRows,
  compactLines,
  createOfficePlanForm,
  extractNoteValue,
  formatApiWorkflowError,
  isCheckinWorkLog,
  noteHasClientAccepted,
  parseOptionalFinishMoney,
  parseSafetyLogRows,
  photoTypMatches,
  suggestedFinishOperationalCosts,
  workflowPhotoFilterFor,
  workflowTargetFor,
} = moduleRef.exports;

function run() {
  assert.equal(photoTypMatches(' Po ', ['po']), true);
  assert.equal(photoTypMatches('before', ['przed']), false);
  assert.equal(isCheckinWorkLog({ status: 'check-in' }), true);
  assert.equal(isCheckinWorkLog('check_in'), true);

  assert.equal(absolutePhotoUrl('file:///tmp/photo.jpg'), 'file:///tmp/photo.jpg');
  assert.equal(absolutePhotoUrl('content://media/photo'), 'content://media/photo');
  assert.equal(absolutePhotoUrl('/uploads/a.jpg').endsWith('/uploads/a.jpg'), true);

  assert.deepEqual(compactLines(' A \n\n B '), ['A', 'B']);
  assert.equal(extractNoteValue('Ryzyka: linia\nWarunki rozliczenia: gotowka', ['Ryzyka']), 'linia');
  assert.equal(noteHasClientAccepted('Klient zaakceptowal: tak'), true);

  assert.deepEqual(parseOptionalFinishMoney('12,345'), { ok: true, amount: 12.35 });
  assert.deepEqual(parseOptionalFinishMoney(''), { ok: true, amount: null });
  assert.deepEqual(parseOptionalFinishMoney('-1'), { ok: false });
  assert.deepEqual(buildFinishOperationalCostRows({
    sprzet: '100',
    paliwo: '20,5',
    utylizacja: '',
    inne: '0',
  }), {
    ok: true,
    rows: [
      { category: 'sprzet', amount: 100, label: 'sprzet', source: 'mobile_finish' },
      { category: 'paliwo', amount: 20.5, label: 'paliwo', source: 'mobile_finish' },
      { category: 'inne', amount: 0, label: 'inne', source: 'mobile_finish' },
    ],
  });
  assert.deepEqual(buildFinishOperationalCostRows({ sprzet: 'x' }), { ok: false, label: 'sprzet' });
  assert.deepEqual(buildFinishMaterialUsage('  Olej  ', '2,5', 30), [
    { nazwa: 'Olej', ilosc: 2.5, jednostka: 'szt', koszt_laczny: 30 },
  ]);
  assert.equal(buildFinishMaterialUsage('', '2', null), undefined);
  assert.deepEqual(suggestedFinishOperationalCosts({
    suggestions: [
      { category: 'sprzet', label: 'Sprzet', amount: 150 },
      { category: 'paliwo', label: 'Paliwo', amount: 0 },
      { category: 'inne', label: 'Inne', amount: 12.5 },
    ],
  }), { sprzet: '150', paliwo: '', utylizacja: '', inne: '12.5' });

  assert.deepEqual(parseSafetyLogRows('[{"key":"zone","label":"Strefa","done":true}]'), [
    { key: 'zone', label: 'Strefa', hint: null, done: true },
  ]);

  assert.deepEqual(createOfficePlanForm({
    data_planowana: '2026-06-01T09:30:00.000Z',
    czas_planowany_godziny: '4',
    ekipa_id: 7,
    rezerwacje_sprzetu: [{ sprzet_id: 1 }, { sprzetId: 1 }, { equipment_id: 2 }],
  }), {
    data: '2026-06-01',
    godzina: '09:30',
    czas: '4',
    ekipaId: '7',
    sprzetIds: ['1', '2'],
    note: '',
  });

  assert.equal(workflowTargetFor({ key: 'zdjecie_po', label: 'Zdjecie po', required: true }), 'photos');
  assert.equal(workflowTargetFor({ key: 'budzet', label: 'Budzet', required: true }), 'field');
  assert.equal(workflowPhotoFilterFor({ key: 'szkic', label: 'Szkic', required: true }), 'szkic');
  assert.match(formatApiWorkflowError({ error: 'Braki', missing_labels: ['Foto', 'BHP'] }), /Foto/);

  console.log('ok testZlecenieDetail');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
