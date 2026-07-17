import superSeed from './super-seed.mjs';
import { hashPassword } from './security.mjs';

const now = '2026-09-01T08:00:00.000Z';

// Bootstrap haseł przy wdrożeniu: w NODE_ENV=production konta bez passwordHash
// nie mogą się logować, więc seed nadaje hasła z env (ARBOR_ADMIN_PASSWORD dla
// administratorów, ARBOR_USERS_PASSWORD dla pozostałych kont startowych).
// Bez env: bez haseł (tryb demo/dev — logowanie samym loginem).
const seedUsers = [
  { id: 'u-admin', login: 'admin', firstName: 'Alicja', lastName: 'Nowak', role: 'ADMINISTRATOR', branchId: 'krk' },
  { id: 'u-dir', login: 'dyrektor', firstName: 'Marek', lastName: 'Kowal', role: 'DYREKTOR', branchId: 'krk' },
  { id: 'u-manager', login: 'kierownik', firstName: 'Olga', lastName: 'Maj', role: 'KIEROWNIK', branchId: 'krk' },
  { id: 'u-est', login: 'wycena', firstName: 'Tomasz', lastName: 'Lis', role: 'WYCENIAJACY', branchId: 'krk' },
  { id: 'u-lead', login: 'brygadzista', firstName: 'Piotr', lastName: 'Wrona', role: 'BRYGADZISTA', branchId: 'krk', teamId: 'team-a1' },
  { id: 'u-worker', login: 'pracownik', firstName: 'Kamil', lastName: 'Sowa', role: 'PRACOWNIK', branchId: 'krk', teamId: 'team-a1' },
  { id: 'u-acc', login: 'ksiegowa', firstName: 'Ewa', lastName: 'Król', role: 'KSIEGOWA', branchId: 'krk' },
  { id: 'u-other-admin', login: 'other-admin', firstName: 'Ola', lastName: 'Tenant', role: 'ADMINISTRATOR', branchId: 'oth' },
];
const adminPassword = process.env.ARBOR_ADMIN_PASSWORD || '';
const usersPassword = process.env.ARBOR_USERS_PASSWORD || '';
for (const user of seedUsers) {
  const password = user.role === 'ADMINISTRATOR' ? (adminPassword || usersPassword) : usersPassword;
  if (password) user.passwordHash = hashPassword(password);
}

const demoSeed = {
  ...superSeed,
  branches: [
    // tenantId JAWNIE — sterownik SQLite dokleja domyślny tenant przy zapisie,
    // ale PostgreSQL trzyma dokument bez normalizacji; bez tenantId oddziały
    // wypadały ze skopowania per-tenant (wyciek między tenantami na PG).
    { id: 'krk', tenantId: 'tenant-pf', name: 'Oddział Kraków', city: 'Kraków' },
    { id: 'waw', tenantId: 'tenant-pf', name: 'Oddział Warszawa', city: 'Warszawa' },
    { id: 'oth', tenantId: 'tenant-other', name: 'Oddzial Testowy', city: 'Gdansk' },
  ],
  users: seedUsers,
  clients: [
    { id: 'c-1', branchId: 'krk', name: 'Wspólnota Parkowa 12', phone: '+48 501 240 900', email: 'zarzad@parkowa12.pl', address: 'Parkowa 12, Kraków', ltv: 86200, tags: ['stały klient', 'osiedle'], pipelineStage: 'oferta', customFields: { segment: 'B2B' } },
    { id: 'c-2', branchId: 'krk', name: 'Anna Zielińska', phone: '+48 608 455 233', email: 'anna@zielinska.pl', address: 'Leśna 7, Wieliczka', ltv: 9400, tags: ['ogród'], pipelineStage: 'lead', customFields: { preferencje: 'SMS' } },
    { id: 'c-3', branchId: 'krk', name: 'Hotel Pod Klonem', phone: '+48 512 900 144', email: 'recepcja@podklonem.pl', address: 'Sadowa 3, Kraków', ltv: 43800, tags: ['hotel', 'pilne'], pipelineStage: 'negocjacje', customFields: { segment: 'B2B' } },
    { id: 'c-4', branchId: 'krk', name: 'Jan Malina', phone: '+48 730 111 402', email: 'jan@malina.pl', address: 'Brzozowa 2, Niepołomice', ltv: 5200, tags: ['nowy lead'], pipelineStage: 'kontakt', customFields: { źródło: 'telefon' } },
    { id: 'c-other-1', branchId: 'oth', name: 'Ukryty Klient Tenant', phone: '+48 700 000 999', email: 'tenant@example.test', address: 'Tenantowa 1, Gdansk', ltv: 999999, tags: ['tenant-other'], pipelineStage: 'lead', customFields: { segment: 'isolation-test' } },
  ],
  crews: [
    { id: 'team-a1', name: 'Ekipa A1', leaderId: 'u-lead', branchId: 'krk', members: ['Piotr Wrona', 'Kamil Sowa', 'Robert Wilk'], utilization: 86 },
    { id: 'team-a2', name: 'Ekipa A2', leaderId: 'u-worker', branchId: 'krk', members: ['Michał Topola', 'Adam Grab'], utilization: 64 },
    { id: 'team-b1', name: 'Ekipa B1', leaderId: 'u-worker', branchId: 'waw', members: ['Karol Grab', 'Joanna Liść'], utilization: 72 },
  ],
  orders: [
    {
      id: 'Z-1024', clientId: 'c-1', address: 'Parkowa 12', city: 'Kraków', type: 'Pielęgnacja koron',
      status: 'ZAPLANOWANE', priority: 'wysoki', teamId: 'team-a1', branchId: 'krk', estimatorId: 'u-est',
      scheduledAt: '2026-09-09T08:00:00.000Z', inspectionAt: '2026-09-02T10:30:00.000Z', value: 18600, margin: 38,
      timeline: [
        { label: 'Telefon i kwalifikacja', at: '2026-08-29T09:12:00.000Z', by: 'Biuro' },
        { label: 'Oględziny umówione', at: '2026-08-29T09:20:00.000Z', by: 'Olga Maj' },
      ],
      checklist: [{ label: 'BHP przed pracą', done: false }, { label: 'Zdjęcia przed', done: false }, { label: 'Podpis klienta', done: false }],
    },
    {
      id: 'Z-1025', clientId: 'c-2', address: 'Leśna 7', city: 'Wieliczka', type: 'Wycinka świerka',
      status: 'NOWE', priority: 'normalny', branchId: 'krk', estimatorId: 'u-est',
      scheduledAt: '2026-09-11T09:00:00.000Z', inspectionAt: '2026-09-05T12:00:00.000Z', value: 4200, margin: 32,
      timeline: [{ label: 'Nowe zapytanie', at: '2026-08-30T11:03:00.000Z', by: 'Zadarma' }],
      checklist: [{ label: 'BHP przed pracą', done: false }, { label: 'Zdjęcia przed', done: false }, { label: 'Podpis klienta', done: false }],
    },
    {
      id: 'Z-1026', clientId: 'c-3', address: 'Sadowa 3', city: 'Kraków', type: 'Usunięcie posuszu',
      status: 'W_REALIZACJI', priority: 'pilny', teamId: 'team-a2', branchId: 'krk',
      scheduledAt: '2026-09-01T07:30:00.000Z', value: 12800, margin: 41,
      timeline: [{ label: 'Start realizacji', at: '2026-09-01T07:42:00.000Z', by: 'Ekipa A2' }],
      checklist: [{ label: 'BHP przed pracą', done: true }, { label: 'Zdjęcia przed', done: true }, { label: 'Podpis klienta', done: false }],
    },
    {
      id: 'Z-1027', clientId: 'c-4', address: 'Brzozowa 2', city: 'Niepołomice', type: 'Frezowanie pnia',
      status: 'ZAKONCZONE', priority: 'niski', teamId: 'team-a1', branchId: 'krk',
      scheduledAt: '2026-08-26T10:00:00.000Z', value: 2200, margin: 45,
      timeline: [{ label: 'Zamknięte z podpisem', at: '2026-08-26T13:10:00.000Z', by: 'Piotr Wrona' }],
      checklist: [{ label: 'BHP przed pracą', done: true }, { label: 'Zdjęcia przed', done: true }, { label: 'Podpis klienta', done: true }],
    },
    {
      id: 'Z-OTH-1', clientId: 'c-other-1', address: 'Tenantowa 1', city: 'Gdansk', type: 'Ukryte zlecenie tenant',
      status: 'NOWE', priority: 'normalny', branchId: 'oth',
      scheduledAt: '2026-09-13T10:00:00.000Z', value: 77777, margin: 50,
      timeline: [{ label: 'Tenant isolation fixture', at: now, by: 'System' }],
      checklist: [{ label: 'Ukryty check', done: false }],
    },
  ],
  valuations: [
    {
      id: 'W-451', orderId: 'Z-1025', clientId: 'c-2', estimatorId: 'u-est', status: 'do_potwierdzenia',
      inspectionAt: '2026-09-05T12:00:00.000Z', totalNet: 4200, margin: 32, media: ['zdjęcie korony', 'oznaczony zakres cięcia'],
      notes: 'Drzewo blisko ogrodzenia, potrzebny rębak i asekuracja linowa.',
      items: [
        { name: 'Wycinka sekcyjna świerka', qty: 1, unit: 'szt.', price: 3200, cost: 2100 },
        { name: 'Rębak i wywóz gałęzi', qty: 1, unit: 'usł.', price: 1000, cost: 760 },
      ],
    },
    {
      id: 'W-452', orderId: 'Z-1024', clientId: 'c-1', estimatorId: 'u-est', status: 'zatwierdzona',
      inspectionAt: '2026-09-02T10:30:00.000Z', totalNet: 18600, margin: 38, media: ['aleja frontowa', 'mapa zakresu'],
      notes: 'Prace etapowe, wymagana informacja dla mieszkańców 48h wcześniej.',
      items: [{ name: 'Pielęgnacja koron', qty: 18, unit: 'drzew', price: 900, cost: 560 }],
    },
  ],
  treeAssets: [
    {
      id: 'tree-parkowa-1',
      tenantId: 'tenant-pf',
      branchId: 'krk',
      clientId: 'c-1',
      orderId: 'Z-1024',
      valuationId: 'W-452',
      species: 'Quercus robur',
      commonName: 'Dab szypulkowy',
      heightM: 18.5,
      diameterCm: 62,
      condition: 'good',
      riskLevel: 'medium',
      workRecommendation: 'Pielegnacja korony, usuniecie posuszu i zabezpieczenie parkingu.',
      gpsLat: 50.0647,
      gpsLng: 19.945,
      photos: ['/photos/demo/tree-parkowa-1-before.jpg'],
      notes: 'Drzewo przy parkingu wspolnoty.',
      status: 'active',
      lastInspectionAt: '2026-09-02T10:45:00.000Z',
      createdAt: now,
      createdBy: 'u-est',
      updatedAt: now,
      updatedBy: 'u-est',
    },
    {
      id: 'tree-lesna-1',
      tenantId: 'tenant-pf',
      branchId: 'krk',
      clientId: 'c-2',
      orderId: 'Z-1025',
      valuationId: 'W-451',
      species: 'Picea abies',
      commonName: 'Swierk pospolity',
      heightM: 14,
      diameterCm: 41,
      condition: 'poor',
      riskLevel: 'high',
      workRecommendation: 'Wycinka sekcyjna z asekuracja linowa i wywozem galezi.',
      gpsLat: 49.9873,
      gpsLng: 20.0642,
      photos: ['/photos/demo/tree-lesna-1-before.jpg'],
      notes: 'Blisko ogrodzenia i sasiedniej posesji.',
      status: 'active',
      lastInspectionAt: '2026-09-05T12:18:00.000Z',
      createdAt: now,
      createdBy: 'u-est',
      updatedAt: now,
      updatedBy: 'u-est',
    },
    {
      id: 'tree-other-1',
      tenantId: 'tenant-other',
      branchId: 'oth',
      clientId: 'c-other-1',
      orderId: 'Z-OTH-1',
      species: 'Acer platanoides',
      commonName: 'Klon zwyczajny',
      heightM: 9,
      diameterCm: 28,
      condition: 'fair',
      riskLevel: 'low',
      workRecommendation: 'Tenant isolation fixture.',
      photos: [],
      status: 'active',
      lastInspectionAt: now,
      createdAt: now,
      createdBy: 'u-other-admin',
      updatedAt: now,
      updatedBy: 'u-other-admin',
    },
  ],
  equipment: [
    { id: 'eq-1', name: 'Podnośnik Ruthmann 27m', type: 'podnosnik', status: 'zarezerwowany', branchId: 'krk', risk: 'sredni', reviewDue: '2026-10-15' },
    { id: 'eq-2', name: 'Rębak Timberwolf TW230', type: 'rebak', status: 'dostepny', branchId: 'krk', risk: 'niski', reviewDue: '2026-11-02' },
    { id: 'eq-3', name: 'Ford Transit KR 8PF12', type: 'pojazd', status: 'w_terenie', branchId: 'krk', risk: 'niski', reviewDue: '2026-09-28' },
    { id: 'eq-4', name: 'Pilarka Stihl MS 500i', type: 'pilarka', status: 'serwis', branchId: 'krk', risk: 'wysoki', reviewDue: '2026-08-29' },
  ],
  warehouseItems: [
    { id: 'wh-1', branchId: 'krk', name: 'Olej do łańcuchów', unit: 'l', stock: 48, minStock: 20, supplier: 'Forest Parts', updatedAt: now },
    { id: 'wh-2', branchId: 'krk', name: 'Paliwo Aspen 2T', unit: 'l', stock: 32, minStock: 25, supplier: 'ArboMarket', updatedAt: now },
    { id: 'wh-3', branchId: 'krk', name: 'Lina arborystyczna 45m', unit: 'szt', stock: 6, minStock: 3, supplier: 'ClimbPro', updatedAt: now },
    { id: 'wh-4', branchId: 'waw', name: 'Worki Big Bag', unit: 'szt', stock: 18, minStock: 10, supplier: 'GreenPack', updatedAt: now },
  ],
  warehouseMovements: [],
  invoices: [
    { id: 'fv-1', number: 'FV/08/2026/121', orderId: 'Z-1027', clientId: 'c-4', net: 2200, dueAt: '2026-09-09', status: 'wyslana' },
    { id: 'fv-2', number: 'FV/09/2026/004', orderId: 'Z-1026', clientId: 'c-3', net: 12800, dueAt: '2026-09-15', status: 'szkic' },
    { id: 'fv-3', number: 'FV/08/2026/102', orderId: 'Z-1018', clientId: 'c-1', net: 9600, dueAt: '2026-08-30', status: 'oplacona' },
    { id: 'fv-other-1', number: 'FV/09/2026/OTH', orderId: 'Z-OTH-1', clientId: 'c-other-1', net: 77777, dueAt: '2026-09-30', status: 'szkic' },
  ],
  notifications: [
    { id: 'n-1', channel: 'valuations', role: 'KIEROWNIK', title: 'Wycena do potwierdzenia', body: 'Anna Zielińska, 4 200 zł netto', unread: true, createdAt: now },
    { id: 'n-2', channel: 'gps', role: 'DYREKTOR', title: 'Ekipa A2 na miejscu', body: 'Geofence Sadowa 3 aktywowany', unread: true, createdAt: now },
    { id: 'n-3', channel: 'announcements', role: 'ALL', title: 'Szkolenie BHP', body: 'Czwartek 7:00, magazyn Kraków', unread: false, createdAt: now },
  ],
  auditEvents: [
    { id: 'a-1', actorId: 'u-manager', action: 'valuation.approved', entity: 'W-452', at: now, payload: '{"team":"team-a1"}' },
    { id: 'a-2', actorId: 'u-lead', action: 'safety.confirmed', entity: 'Z-1026', at: now, payload: '{"checks":6}' },
  ],
  portal: { accepted: false, paid: false, rating: 0, messages: ['Dzień dobry, czy termin 09.09 jest aktualny?'] },
  offlineQueue: [],
  outbox: [],
};

// Seed produkcyjny: konfiguracja platformy (plany, role, szablony, moduły) + firma
// Polska Flora z kontami startowymi — ZERO fikcyjnych danych operacyjnych i bez
// tenanta testowego. Pełne dane demo tylko poza produkcją albo z ARBOR_SEED_DEMO=1.
function productionSeed(full) {
  return {
    ...full,
    tenants: (full.tenants ?? []).filter((t) => t.id !== 'tenant-other'),
    tenantSubscriptions: (full.tenantSubscriptions ?? []).filter((s) => s.tenantId !== 'tenant-other'),
    integrationSettings: (full.integrationSettings ?? []).filter((s) => s.tenantId !== 'tenant-other'),
    branches: (full.branches ?? []).filter((b) => b.id !== 'oth'),
    users: (full.users ?? []).filter((u) => u.branchId !== 'oth'),
    billingPayments: [],
    communications: [],
    softphonePresence: [],
    aiBotSessions: [],
    workflowRuns: [],
    tasks: [],
    generatedDocuments: [],
    employeeContracts: [],
    trainings: [],
    medicalExams: [],
    certifications: [],
    clients: [],
    crews: [],
    orders: [],
    valuations: [],
    treeAssets: [],
    equipment: [],
    warehouseItems: [],
    warehouseMovements: [],
    invoices: [],
    notifications: [],
    auditEvents: [],
    portal: { accepted: false, paid: false, rating: 0, messages: [] },
    offlineQueue: [],
    outbox: [],
  };
}

const useDemoData = process.env.NODE_ENV !== 'production' || process.env.ARBOR_SEED_DEMO === '1';
export default useDemoData ? demoSeed : productionSeed(demoSeed);
