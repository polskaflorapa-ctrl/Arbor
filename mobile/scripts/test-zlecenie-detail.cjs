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
  buildFinishBody,
  buildFinishMaterialUsage,
  buildFinishOperationalCostRows,
  buildFinishProtocolNotes,
  buildPhotoGalleryFilters,
  compactLines,
  createOfficePlanForm,
  extractNoteValue,
  filterBriefingPhotos,
  filterPhotosByGalleryFilter,
  formatApiWorkflowError,
  isCheckinWorkLog,
  hasMinimumFinishPhotos,
  noteHasClientAccepted,
  parseOptionalFinishMoney,
  parseSafetyLogRows,
  photoGalleryGroupKeys,
  photoPreviewState,
  photoTypeKey,
  photoTypeLabel,
  photoTypMatches,
  nextPreviewPhoto,
  suggestedFinishOperationalCosts,
  taskPhotoEvidenceCounts,
  validateFinishPayment,
  workflowPhotoFilterFor,
  workflowTargetFor,
} = moduleRef.exports;

function run() {
  assert.equal(photoTypMatches(' Po ', ['po']), true);
  assert.equal(photoTypMatches('before', ['przed']), false);
  assert.equal(isCheckinWorkLog({ status: 'check-in' }), true);
  assert.equal(isCheckinWorkLog('check_in'), true);
  const photoRows = [
    { id: 1, typ: 'wycena' },
    { id: 2, typ: 'szkic' },
    { id: 3, typ: 'dojazd_posesja' },
    { id: 4, typ: 'checkin' },
    { id: 5, typ: 'po' },
    { id: 6, typ: 'other' },
    { id: 7, typ: '' },
  ];
  assert.deepEqual(taskPhotoEvidenceCounts(photoRows), {
    fieldWycena: 2,
    fieldSketch: 1,
    fieldAccess: 1,
    before: 1,
    after: 1,
    other: 2,
  });
  assert.deepEqual(filterPhotosByGalleryFilter(photoRows, 'inne').map((row) => row.id), [6, 7]);
  assert.deepEqual(filterPhotosByGalleryFilter(photoRows, 'all').map((row) => row.id), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(filterBriefingPhotos(photoRows).map((row) => row.id), [1, 2, 4]);
  assert.equal(hasMinimumFinishPhotos([{ typ: 'po' }, { typ: 'after' }], 'after', 2), true);
  assert.equal(hasMinimumFinishPhotos([{ typ: 'przed' }], 'before', 2), false);
  assert.deepEqual(photoGalleryGroupKeys('po'), ['po']);
  assert.deepEqual(photoPreviewState(photoRows, [photoRows[4]], null), {
    activePhoto: photoRows[4],
    photoList: [photoRows[4]],
    safeIndex: 0,
    counter: '1/1',
  });
  assert.deepEqual(photoPreviewState(photoRows, [], photoRows[2]), {
    activePhoto: photoRows[2],
    photoList: photoRows,
    safeIndex: 2,
    counter: '3/7',
  });
  assert.equal(nextPreviewPhoto(photoRows, 0, -1), photoRows[6]);
  assert.equal(nextPreviewPhoto(photoRows, 6, 1), photoRows[0]);
  assert.equal(nextPreviewPhoto([], 0, 1), null);
  assert.equal(photoTypeKey('po'), 'po');
  assert.equal(photoTypeKey('unknown'), 'inne');
  assert.equal(photoTypeLabel('szkic'), 'Szkic zakresu');
  assert.equal(photoTypeLabel('unknown'), 'Inne');
  const themeForPhotos = {
    accent: '#1',
    info: '#2',
    warning: '#3',
    success: '#4',
    textSub: '#5',
    textMuted: '#6',
  };
  assert.deepEqual(buildPhotoGalleryFilters(photoRows, themeForPhotos).map((filter) => ({
    key: filter.key,
    count: filter.count,
    icon: filter.icon,
  })), [
    { key: 'all', count: 7, icon: 'images-outline' },
    { key: 'wycena', count: 1, icon: 'clipboard' },
    { key: 'szkic', count: 1, icon: 'create' },
    { key: 'dojazd', count: 0, icon: 'navigate' },
    { key: 'checkin', count: 1, icon: 'location' },
    { key: 'przed', count: 0, icon: 'camera' },
    { key: 'po', count: 1, icon: 'checkmark-circle' },
    { key: 'inne', count: 2, icon: 'images' },
  ]);

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
  assert.deepEqual(validateFinishPayment({
    forma_platnosc: 'Gotowka',
    kwota_odebrana: '120,50',
    faktura_vat: false,
    nip: '',
  }), { ok: true, cashAmount: 120.5, nip: null });
  assert.deepEqual(validateFinishPayment({
    forma_platnosc: 'Gotowka',
    kwota_odebrana: '-1',
    faktura_vat: false,
    nip: '',
  }), { ok: false, reason: 'cash_amount' });
  assert.deepEqual(validateFinishPayment({
    forma_platnosc: 'Faktura_VAT',
    kwota_odebrana: '',
    faktura_vat: true,
    nip: '123 456 7890',
  }), { ok: true, cashAmount: null, nip: '1234567890' });
  assert.deepEqual(validateFinishPayment({
    forma_platnosc: 'Faktura_VAT',
    kwota_odebrana: '',
    faktura_vat: true,
    nip: '123',
  }), { ok: false, reason: 'nip' });
  assert.deepEqual(buildFinishProtocolNotes({
    paymentNote: 'Platnosc przy odbiorze',
    safetyRows: [
      { done: true, label: 'Strefa pracy' },
      { done: false, label: 'Sprzet' },
    ],
    afterPhotosCount: 3,
    unresolvedIssuesCount: 1,
    hasClientSignature: true,
    clientSignerName: 'Jan',
    finishClientAccepted: false,
    usageName: 'Olej',
    materialUsage: [{ nazwa: 'Olej', ilosc: 2, jednostka: 'szt' }],
  }), {
    safetyProtocolNote: 'BHP przed startem: 1/2 punktow.\nOK Strefa pracy\nBRAK Sprzet',
    closeProtocolNote: 'BHP przed startem: 1/2 punktow.\nOK Strefa pracy\nBRAK Sprzet\nZamknięcie mobilne: zdjęcia po 3; problemy otwarte 1.\nOdbiór klienta: podpis Jan.\nMateriały: Olej (2 szt.).',
    noteTrim: 'Platnosc przy odbiorze\nBHP przed startem: 1/2 punktow.\nOK Strefa pracy\nBRAK Sprzet\nZamknięcie mobilne: zdjęcia po 3; problemy otwarte 1.\nOdbiór klienta: podpis Jan.\nMateriały: Olej (2 szt.).',
  });
  assert.deepEqual(buildFinishBody({
    coords: { lat: 52.1, lng: 21.2 },
    notes: {
      safetyProtocolNote: 'BHP',
      closeProtocolNote: 'Zamkniecie',
      noteTrim: 'Platnosc\nZamkniecie',
    },
    materialUsage: [{ nazwa: 'Olej', ilosc: 2, jednostka: 'szt', koszt_laczny: 30 }],
    operationalCostRows: [{ category: 'paliwo', amount: 20, label: 'paliwo', source: 'mobile_finish' }],
    paymentForm: { forma_platnosc: 'Gotowka', faktura_vat: false },
    paymentValidation: { ok: true, cashAmount: 120.5, nip: null },
    paymentNote: 'Platnosc',
  }), {
    lat: 52.1,
    lng: 21.2,
    notatki: 'Platnosc\nZamkniecie',
    zuzyte_materialy: [{ nazwa: 'Olej', ilosc: 2, jednostka: 'szt', koszt_laczny: 30 }],
    koszty_operacyjne: [{ category: 'paliwo', amount: 20, label: 'paliwo', source: 'mobile_finish' }],
    payment: {
      forma_platnosc: 'Gotowka',
      kwota_odebrana: 120.5,
      faktura_vat: false,
      nip: null,
      notatki: 'Platnosc',
    },
  });

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
