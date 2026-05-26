/**
 * Test mode utilities dla web aplikacji.
 * Włącz: VITE_TEST_MODE=true w .env lub przez dev panel
 */

const TEST_MODE_STORAGE_KEY = 'arbor-test-mode';
const MOCK_TASK_OVERRIDES_KEY = 'arbor-test-mode-task-overrides';
const MOCK_TASK_PHOTOS_KEY = 'arbor-test-mode-task-photos';

// Testowi użytkownicy o różnych rolach
export const TEST_USERS = {
  dyrektor: {
    id: 9001,
    imie: 'Test',
    nazwisko: 'Dyrektor',
    email: 'dyrektor@test.local',
    rola: 'Dyrektor',
    oddzial_id: 1,
  },
  kierownik: {
    id: 9002,
    imie: 'Test',
    nazwisko: 'Kierownik',
    email: 'kierownik@test.local',
    rola: 'Kierownik',
    oddzial_id: 2,
  },
  brygadzista: {
    id: 9003,
    imie: 'Test',
    nazwisko: 'Brygadzista',
    email: 'brygadzista@test.local',
    rola: 'Brygadzista',
    oddzial_id: 2,
    ekipa_id: 5,
  },
  wyceniajacy: {
    id: 9004,
    imie: 'Test',
    nazwisko: 'Specjalista Wyceny',
    email: 'wyceniajacy@test.local',
    rola: 'Wyceniający',
    oddzial_id: 1,
  },
  dyrektorSprzedazy: {
    id: 9010,
    imie: 'Test',
    nazwisko: 'Dyrektor Sprzedazy',
    email: 'sprzedaz@test.local',
    rola: 'Dyrektor Sprzedazy',
    oddzial_id: null,
  },
  specjalistaWroclaw: {
    id: 9011,
    imie: 'Test',
    nazwisko: 'Specjalista Wroclaw',
    email: 'wroclaw@test.local',
    rola: 'Specjalista',
    oddzial_id: 3,
  },
};

// Token testowy (nie będzie walidowany w trybie testowym)
export const TEST_TOKEN = 'test_token_' + Math.random().toString(36).substr(2, 9);

// Makiety danych dla API
export const MOCK_DATA = {
  zlecenia: [
    {
      id: 101,
      klient_nazwa: 'Anna Kowalska',
      klient_telefon: '+48500111222',
      adres: 'ul. Lesna 12',
      miasto: 'Krakow',
      typ_uslugi: 'Wycinka',
      status: 'Nowe',
      priorytet: 'Normalny',
      data_planowana: '',
      wartosc_planowana: '',
      czas_planowany_godziny: '',
      ekipa_id: '',
      wyceniajacy_id: '',
      opis_pracy: 'Klient dzwoni do biura, trzeba umowic ogledziny.',
      oddzial_id: 1,
      photo_total: 0,
      photo_wycena: 0,
      photo_szkic: 0,
      photo_dojazd: 0,
      work_logs_total: 0,
      active_work_count: 0,
      problem_total: 0,
      problem_open: 0,
      last_checkin_at: null,
      active_work_started_at: null,
      last_work_finished_at: null,
    },
    {
      id: 102,
      klient_nazwa: 'Wspolnota Zielona 8',
      klient_telefon: '+48500666777',
      adres: 'ul. Testowa 2',
      miasto: 'Krakow',
      typ_uslugi: 'Pielegnacja',
      status: 'Wycena_Terenowa',
      priorytet: 'Pilny',
      data_planowana: new Date().toISOString().slice(0, 10),
      wyceniajacy_id: 9004,
      wyceniajacy_nazwa: 'Test Specjalista Wyceny',
      ekipa_id: '',
      wartosc_planowana: 0,
      czas_planowany_godziny: '',
      opis_pracy: 'Specjalista ds. wyceny ma zebrac zdjecia, zakres i cene u klienta.',
      oddzial_id: 2,
      photo_total: 2,
      photo_wycena: 1,
      photo_szkic: 0,
      photo_dojazd: 1,
      work_logs_total: 1,
      active_work_count: 0,
      problem_total: 1,
      problem_open: 1,
      last_checkin_at: new Date(Date.now() - 42 * 60000).toISOString(),
      active_work_started_at: null,
      last_work_finished_at: null,
    },
    {
      id: 103,
      klient_nazwa: 'Osiedle Lesne Tarasy',
      klient_telefon: '+48500999888',
      adres: 'ul. Zielona 21',
      miasto: 'Wieliczka',
      typ_uslugi: 'Wycinka',
      status: 'Do_Zatwierdzenia',
      priorytet: 'Normalny',
      data_planowana: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      wyceniajacy_id: 9004,
      wyceniajacy_nazwa: 'Test Specjalista Wyceny',
      ekipa_id: 5,
      ekipa_nazwa: 'Ekipa A',
      wartosc_planowana: 2800,
      czas_planowany_godziny: 3,
      opis_pracy: 'Klient zaakceptowal zakres, biuro zatwierdza termin i ekipe.',
      oddzial_id: 3,
      photo_total: 5,
      photo_wycena: 2,
      photo_szkic: 2,
      photo_dojazd: 1,
      work_logs_total: 2,
      active_work_count: 1,
      problem_total: 0,
      problem_open: 0,
      last_checkin_at: new Date(Date.now() - 74 * 60000).toISOString(),
      active_work_started_at: new Date(Date.now() - 68 * 60000).toISOString(),
      last_work_finished_at: null,
    },
    {
      id: 1,
      klient_nazwa: 'Test Klient 1',
      adres: 'ul. Testowa 1, 00-001 Warszawa',
      miasto: 'Warszawa',
      typ_uslugi: 'Inspekcja',
      status: 'Nowe',
      data_zaplanowana: new Date().toISOString(),
      brygadzista_id: 9003,
      ekipa_id: 5,
      oddzial_id: 2,
      opis: 'Testowe zlecenie 1',
    },
    {
      id: 2,
      klient_nazwa: 'Test Klient 2',
      adres: 'ul. Testowa 2, 00-002 Kraków',
      miasto: 'Kraków',
      typ_uslugi: 'Konsultacja',
      status: 'W realizacji',
      data_zaplanowana: new Date(Date.now() - 86400000).toISOString(),
      brygadzista_id: 9003,
      ekipa_id: 5,
      oddzial_id: 2,
      opis: 'Testowe zlecenie 2',
    },
  ],
  oddzialy: [
    {
      id: 1,
      nazwa: 'Oddział Warszawa',
      adres: 'ul. Główna 1, 00-001 Warszawa',
      telefon: '+48 22 123 45 67',
      kierownik_id: 9002,
    },
    {
      id: 2,
      nazwa: 'Oddział Kraków',
      adres: 'ul. Główna 2, 30-000 Kraków',
      telefon: '+48 12 987 65 43',
      kierownik_id: 9005,
    },
    {
      id: 3,
      nazwa: 'Oddzial Wroclaw',
      adres: 'ul. Glowna 3, 50-000 Wroclaw',
      telefon: '+48 71 111 22 33',
      kierownik_id: null,
    },
  ],
  uzytkownicy: [
    { ...TEST_USERS.dyrektor, aktywny: true },
    { ...TEST_USERS.kierownik, aktywny: true },
    { ...TEST_USERS.brygadzista, aktywny: true },
    { ...TEST_USERS.wyceniajacy, aktywny: true },
    { ...TEST_USERS.dyrektorSprzedazy, aktywny: true },
    { ...TEST_USERS.specjalistaWroclaw, aktywny: true },
  ],
  ekipy: [
    {
      id: 5,
      nazwa: 'Ekipa A',
      brygadzista_id: 9003,
      oddzial_id: 2,
      pracownicy: [9003, 9006, 9007],
    },
  ],
  liveLocations: [
    {
      ekipa_id: 5,
      ekipa_nazwa: 'Ekipa A',
      oddzial_id: 2,
      wyceniajacy_id: null,
      wyceniajacy_nazwa: null,
      vehicle_id: null,
      nr_rejestracyjny: 'MOBILE_EKIPA',
      lat: 50.06143,
      lng: 19.93658,
      speed_kmh: 7,
      heading: 90,
      recorded_at: new Date().toISOString(),
      provider: 'mobile',
      user_id: 9003,
      user_rola: 'Brygadzista',
    },
    {
      ekipa_id: null,
      ekipa_nazwa: null,
      oddzial_id: 1,
      wyceniajacy_id: 9004,
      wyceniajacy_nazwa: 'Test Specjalista Wyceny',
      vehicle_id: null,
      nr_rejestracyjny: 'MOBILE_WYCENA',
      lat: 50.06712,
      lng: 19.94504,
      speed_kmh: 0,
      heading: 15,
      recorded_at: new Date(Date.now() - 8 * 60000).toISOString(),
      provider: 'mobile',
      user_id: 9004,
      user_rola: 'Wyceniający',
    },
    {
      ekipa_id: 5,
      ekipa_nazwa: 'Ekipa A',
      oddzial_id: 2,
      wyceniajacy_id: null,
      wyceniajacy_nazwa: null,
      vehicle_id: 101,
      nr_rejestracyjny: 'KR 12345',
      lat: 50.05266,
      lng: 19.93112,
      speed_kmh: 22,
      heading: 220,
      recorded_at: new Date(Date.now() - 25 * 60000).toISOString(),
      provider: 'juwentus',
      user_id: null,
      user_rola: null,
    },
  ],
  wyceny: [
    {
      id: 101,
      zlecenie_id: 1,
      kwota: 1250.0,
      status: 'Oczekująca',
      utworzona_dnia: new Date().toISOString(),
      wyceniajacy_id: 9004,
    },
  ],
};

/** Zlecenia „zakończone” mockiem POST /finish — kolejne GET zwraca status Zakonczone. */
const mockFinishedTaskIds = new Set();
const mockTaskOverrides = new Map();
let mockTaskOverridesStorageCache = null;
const mockTaskPhotos = new Map();
let mockTaskPhotosStorageCache = null;

function hydrateMockTaskOverrides() {
  const raw = localStorage.getItem(MOCK_TASK_OVERRIDES_KEY) || '';
  if (raw === mockTaskOverridesStorageCache) return;
  mockTaskOverridesStorageCache = raw;
  mockTaskOverrides.clear();
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    Object.entries(parsed || {}).forEach(([id, value]) => {
      mockTaskOverrides.set(Number(id), { ...(value || {}), id: Number(id) });
    });
  } catch {
    // Ignore malformed persisted test data.
  }
}

function persistMockTaskOverrides() {
  try {
    const payload = Object.fromEntries(mockTaskOverrides.entries());
    mockTaskOverridesStorageCache = JSON.stringify(payload);
    localStorage.setItem(MOCK_TASK_OVERRIDES_KEY, mockTaskOverridesStorageCache);
  } catch {
    // Local persistence is best-effort in test mode.
  }
}

function hydrateMockTaskPhotos() {
  const raw = localStorage.getItem(MOCK_TASK_PHOTOS_KEY) || '';
  if (raw === mockTaskPhotosStorageCache) return;
  mockTaskPhotosStorageCache = raw;
  mockTaskPhotos.clear();
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    Object.entries(parsed || {}).forEach(([id, value]) => {
      mockTaskPhotos.set(Number(id), Array.isArray(value) ? value : []);
    });
  } catch {
    // Ignore malformed persisted test data.
  }
}

function persistMockTaskPhotos() {
  try {
    const payload = Object.fromEntries(mockTaskPhotos.entries());
    mockTaskPhotosStorageCache = JSON.stringify(payload);
    localStorage.setItem(MOCK_TASK_PHOTOS_KEY, mockTaskPhotosStorageCache);
  } catch {
    // Local persistence is best-effort in test mode.
  }
}

function getMockTasksWithOverrides() {
  hydrateMockTaskOverrides();
  const rows = MOCK_DATA.zlecenia.map((task) => ({
    ...task,
    ...(mockTaskOverrides.get(Number(task.id)) || {}),
  }));
  const existingIds = new Set(rows.map((task) => Number(task.id)));
  mockTaskOverrides.forEach((task, id) => {
    if (!existingIds.has(Number(id))) rows.push(task);
  });
  return rows;
}

function getMockTaskBase(taskId) {
  const id = Number(taskId);
  hydrateMockTaskOverrides();
  const base = MOCK_DATA.zlecenia.find((task) => Number(task.id) === id) || {};
  const hasBaseRow = Object.keys(base).length > 0;
  const normalizedBase = { ...base };
  if (hasBaseRow && !normalizedBase.ekipa_id && !normalizedBase.ekipa_nazwa) {
    normalizedBase.ekipa_nazwa = '';
  }
  if (hasBaseRow && !normalizedBase.wyceniajacy_id && !normalizedBase.wyceniajacy_nazwa) {
    normalizedBase.wyceniajacy_nazwa = '';
  }
  return {
    ...normalizedBase,
    ...(mockTaskOverrides.get(id) || {}),
  };
}

export function mockMarkTaskFinishedInTestMode(taskId) {
  mockFinishedTaskIds.add(Number(taskId));
}

export function mockUpdateTaskInTestMode(taskId, patch = {}) {
  hydrateMockTaskOverrides();
  const id = Number(taskId);
  const current = mockTaskOverrides.get(id) || {};
  const next = { ...current, ...patch, id };
  mockTaskOverrides.set(id, next);
  persistMockTaskOverrides();
  if (next.status === 'Zakonczone' || next.status === 'Zakończone') {
    mockMarkTaskFinishedInTestMode(id);
  }
  return getMockTaskDetail(id);
}

function updateMockTaskPhotoCounters(taskId, photos = []) {
  hydrateMockTaskOverrides();
  const id = Number(taskId);
  const counts = photos.reduce(
    (acc, photo) => {
      const type = normalizeMockPhotoType(photo?.typ || photo?.type);
      acc.total += 1;
      if (type === 'wycena') acc.wycena += 1;
      if (type === 'szkic') acc.szkic += 1;
      if (type === 'dojazd') acc.dojazd += 1;
      return acc;
    },
    { total: 0, wycena: 0, szkic: 0, dojazd: 0 }
  );
  const current = mockTaskOverrides.get(id) || {};
  mockTaskOverrides.set(id, {
    ...current,
    id,
    photo_total: counts.total,
    photo_wycena: counts.wycena,
    photo_szkic: counts.szkic,
    photo_dojazd: counts.dojazd,
  });
  persistMockTaskOverrides();
}

/** Szczegół wyceny terenowej (`quotations`) — panel wysyłki F1.11 w trybie testowym. */
export function getMockQuotationDetail(quotationId) {
  const id = Number(quotationId);
  return {
    id,
    status: 'Wyslana_Klientowi',
    klient_nazwa: '[Test] Klient oferty',
    adres: 'ul. Testowa 2',
    miasto: 'Kraków',
    klient_telefon: '+48500111222',
    klient_email: 'test@example.com',
    oddzial_id: 2,
    priorytet: 'Normalny',
    wyslano_klientowi_at: new Date().toISOString(),
    pdf_url: '/uploads/quotations/wycena_test.pdf',
    offer_sms_status: 'sent',
    offer_sms_error: null,
    offer_sms_at: new Date().toISOString(),
    offer_email_status: 'sent',
    offer_email_error: null,
    offer_email_at: new Date().toISOString(),
    client_acceptance_token: 'deadbeefcafe00000000000000000000000000000000000000',
  };
}

/**
 * Sprawdza czy tryb testowy jest aktywny.
 * Priorytet: localStorage > env variable
 */
export function isTestModeEnabled() {
  const stored = localStorage.getItem(TEST_MODE_STORAGE_KEY);
  if (stored !== null) {
    return stored === 'true';
  }
  const viteEnv = import.meta?.env || {};
  const legacyEnv = typeof process !== 'undefined' ? (process.env || {}) : {};
  return (
    viteEnv.VITE_TEST_MODE === 'true' ||
    legacyEnv.VITE_TEST_MODE === 'true' ||
    legacyEnv.REACT_APP_TEST_MODE === 'true'
  );
}

/**
 * Przełącza tryb testowy (w localStorage).
 */
export function toggleTestMode(enabled) {
  localStorage.setItem(TEST_MODE_STORAGE_KEY, String(enabled));
  if (!enabled) {
    mockFinishedTaskIds.clear();
    mockTaskOverrides.clear();
    mockTaskPhotos.clear();
    mockTaskOverridesStorageCache = '';
    mockTaskPhotosStorageCache = '';
    localStorage.removeItem(MOCK_TASK_OVERRIDES_KEY);
    localStorage.removeItem(MOCK_TASK_PHOTOS_KEY);
  }
}

/**
 * Zwraca testowego użytkownika na podstawie roli.
 */
export function getTestUser(role) {
  const roleKey = Object.keys(TEST_USERS).find(
    (k) => TEST_USERS[k].rola.toLowerCase() === (role || '').toLowerCase()
  );
  return roleKey ? TEST_USERS[roleKey] : TEST_USERS.dyrektor;
}

/**
 * Zwraca testowy token.
 */
export function getTestToken() {
  return TEST_TOKEN;
}

/**
 * Szczegół zlecenia (widok ZlecenieDetail) — tryb testowy.
 * Status W_Realizacji + aktywny wpis czasu w logach mockowych → działa ścieżka „Zakończ (płatność)”.
 */
export function getMockTaskDetail(taskId) {
  const id = Number(taskId);
  const finished = mockFinishedTaskIds.has(id);
  const base = getMockTaskBase(id);
  const detail = {
    id,
    klient_nazwa: '[Test] Klient mock',
    adres: 'ul. Mockowa 1',
    miasto: 'Warszawa',
    klient_telefon: '+48111222333',
    typ_uslugi: 'Wycinka',
    priorytet: 'Normalny',
    status: finished ? 'Zakonczone' : 'W_Realizacji',
    data_planowana: new Date().toISOString(),
    wartosc_planowana: 1500,
    wartosc_rzeczywista: null,
    czas_planowany_godziny: 4,
    notatki_wewnetrzne: '',
    notatki_klienta: '',
    opis: 'Zlecenie testowe — tryb mock.',
    oddzial_id: 2,
    oddzial_nazwa: 'Oddział testowy',
    ekipa_id: 5,
    ekipa_nazwa: 'Ekipa testowa',
    kierownik_nazwa: 'Kierownik test',
    brygadzista_id: 9003,
    dodatkowe_uslugi_liczba: 0,
    bony_liczba: 0,
    finish_requirements: {
      require_po_photo: false,
      require_przed_photo: false,
      require_material_usage: false,
      has_po_photo: true,
      has_przed_photo: true,
    },
  };
  const merged = { ...detail, ...base, id };
  if (finished) merged.status = 'Zakonczone';
  return merged;
}

/** Jeden otwarty wpis czasu — wymagany przez POST /tasks/:id/finish na OS. Po mock finish — wpis zamknięty. */
export function getMockTaskLogi(taskId) {
  const id = Number(taskId);
  if (mockFinishedTaskIds.has(id)) {
    return [
      {
        id: 98000 + (id % 1000),
        task_id: id,
        start_time: new Date(Date.now() - 7800000).toISOString(),
        end_time: new Date(Date.now() - 7800000).toISOString(),
        end_lat: 52.2297,
        end_lng: 21.0122,
        start_lat: 52.2297,
        start_lng: 21.0122,
        czas_pracy_minuty: 0,
        duration_hours: 0,
        status: 'Check_In',
        pracownik: 'Test Brygadzista',
      },
      {
        id: 99000 + (id % 1000),
        task_id: id,
        start_time: new Date(Date.now() - 7200000).toISOString(),
        end_time: new Date(Date.now() - 3600000).toISOString(),
        end_lat: 52.23,
        end_lng: 21.01,
        start_lat: 52.2297,
        start_lng: 21.0122,
        czas_pracy_minuty: 60,
        duration_hours: 1,
        status: 'Zakończony',
      },
    ];
  }
  return [
    {
      id: 98000 + (id % 1000),
      task_id: id,
      start_time: new Date(Date.now() - 3900000).toISOString(),
      end_time: new Date(Date.now() - 3900000).toISOString(),
      end_lat: 52.2297,
      end_lng: 21.0122,
      start_lat: 52.2297,
      start_lng: 21.0122,
      czas_pracy_minuty: 0,
      duration_hours: 0,
      status: 'Check_In',
      pracownik: 'Test Brygadzista',
    },
    {
      id: 99000 + (id % 1000),
      task_id: id,
      start_time: new Date(Date.now() - 3600000).toISOString(),
      end_time: null,
      end_lat: null,
      end_lng: null,
      start_lat: 52.2297,
      start_lng: 21.0122,
      czas_pracy_minuty: null,
      duration_hours: null,
      status: 'Aktywny',
    },
  ];
}

/**
 * Przygotowuje mockowe dane dla API (dokładne dopasowanie ścieżki).
 */
function mockPhotoSvg(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><rect width="640" height="420" fill="#07130d"/><rect x="24" y="24" width="592" height="372" rx="24" fill="${color}" opacity="0.18" stroke="${color}" stroke-width="3"/><circle cx="132" cy="132" r="52" fill="${color}" opacity="0.28"/><path d="M92 312c78-116 132-120 194-34 42-66 96-70 170 34H92z" fill="${color}" opacity="0.5"/><text x="48" y="62" fill="#f8fafc" font-family="Arial, sans-serif" font-size="28" font-weight="700">${label}</text><text x="48" y="95" fill="#a7f3d0" font-family="Arial, sans-serif" font-size="16">ARBOR-OS DEMO PHOTO</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function normalizeMockPhotoType(value) {
  const normalized = String(value || 'wycena')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (normalized.includes('szkic')) return 'szkic';
  if (normalized.includes('dojazd')) return 'dojazd';
  if (normalized.includes('przed')) return 'przed';
  if (normalized === 'po' || normalized.includes('po ')) return 'po';
  return 'wycena';
}

function mockPhotoTypeMeta(type) {
  const meta = {
    wycena: ['Wycena', '#22c55e'],
    szkic: ['Szkic', '#38bdf8'],
    dojazd: ['Dojazd', '#f59e0b'],
    przed: ['Przed', '#84cc16'],
    po: ['Po', '#10b981'],
  };
  return meta[type] || meta.wycena;
}

function normalizeMockPhotoTags(value, type) {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean);
  return String(value || type)
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getMockPayloadValue(payload, key) {
  if (!payload) return undefined;
  if (typeof payload.get === 'function') {
    try {
      const value = payload.get(key);
      if (value !== null && value !== undefined) return value;
    } catch {
      // Fall through to object access.
    }
  }
  return payload[key];
}

function buildGeneratedMockTaskPhotos(taskId) {
  const id = Number(taskId);
  const now = Date.now();
  const templateRows = [
    ['wycena', 'Wycena', 'Widok drzewa i zakresu prac', 'wycena,teren', '#22c55e'],
    ['szkic', 'Szkic', 'Szkic ciecia narysowany przez wyceniajacego', 'szkic,zakres', '#38bdf8'],
    ['dojazd', 'Dojazd', 'Brama i dojazd dla ekipy', 'dojazd,posesja', '#f59e0b'],
    ['przed', 'Przed', 'Stan przed rozpoczeciem pracy', 'przed,zakres', '#84cc16'],
    ['po', 'Po', 'Efekt po wykonaniu pracy', 'po,odbior', '#10b981'],
  ];
  const base = getMockTaskBase(id);
  const hasExplicitPhotoTotal = base.photo_total !== undefined && base.photo_total !== null && base.photo_total !== '';
  const total = hasExplicitPhotoTotal ? Math.max(0, Number(base.photo_total) || 0) : templateRows.length;
  if (total <= 0) return [];

  const rows = [];
  const addRows = (type, count) => {
    const template = templateRows.find(([typ]) => typ === type);
    const safeCount = Math.max(0, Number(count) || 0);
    for (let i = 0; template && i < safeCount && rows.length < total; i += 1) rows.push(template);
  };
  addRows('wycena', base.photo_wycena);
  addRows('szkic', base.photo_szkic);
  addRows('dojazd', base.photo_dojazd);
  for (const template of templateRows) {
    if (rows.length >= total) break;
    if (!rows.includes(template)) rows.push(template);
  }
  return rows.map(([typ, label, opis, tagi, color], index) => ({
    id: id * 100 + index + 1,
    task_id: id,
    typ,
    opis,
    tagi: String(tagi).split(','),
    autor: index < 3 ? 'Test Specjalista Wyceny' : 'Test Brygadzista',
    sciezka: mockPhotoSvg(label, color),
    url: mockPhotoSvg(label, color),
    data_dodania: new Date(now - (rows.length - index) * 900000).toISOString(),
    created_at: new Date(now - (rows.length - index) * 900000).toISOString(),
  }));
}

export function getMockTaskPhotos(taskId) {
  const id = Number(taskId);
  hydrateMockTaskPhotos();
  if (mockTaskPhotos.has(id)) return mockTaskPhotos.get(id) || [];
  return buildGeneratedMockTaskPhotos(id);
}

export function mockAddTaskPhotoInTestMode(taskId, payload = {}) {
  const id = Number(taskId);
  const current = getMockTaskPhotos(id);
  const type = normalizeMockPhotoType(getMockPayloadValue(payload, 'typ'));
  const [label, color] = mockPhotoTypeMeta(type);
  const now = new Date().toISOString();
  const file = getMockPayloadValue(payload, 'zdjecie') || getMockPayloadValue(payload, 'file');
  const maxId = current.reduce((acc, photo) => Math.max(acc, Number(photo.id) || 0), id * 100);
  const photo = {
    id: maxId + 1,
    task_id: id,
    typ: type,
    opis: String(getMockPayloadValue(payload, 'opis') || `Zdjecie ${label.toLowerCase()} dodane w trybie testowym`),
    tagi: normalizeMockPhotoTags(getMockPayloadValue(payload, 'tagi'), type),
    autor: 'Tryb testowy',
    nazwa_pliku: file?.name || `${type}-${maxId + 1}.jpg`,
    sciezka: mockPhotoSvg(label, color),
    url: mockPhotoSvg(label, color),
    data_dodania: now,
    created_at: now,
  };
  const next = [...current, photo];
  mockTaskPhotos.set(id, next);
  persistMockTaskPhotos();
  updateMockTaskPhotoCounters(id, next);
  return photo;
}

export function mockDeleteTaskPhotoInTestMode(taskId, photoId) {
  const id = Number(taskId);
  const current = getMockTaskPhotos(id);
  const next = current.filter((photo) => String(photo.id) !== String(photoId));
  mockTaskPhotos.set(id, next);
  persistMockTaskPhotos();
  updateMockTaskPhotoCounters(id, next);
  return { deleted: next.length !== current.length, photos: next };
}

export function getMockTaskProblems(taskId) {
  const id = Number(taskId);
  if (id === 102) {
    return [
      {
        id: 10201,
        task_id: id,
        typ: 'organizacja',
        opis: 'Klient prosi o potwierdzenie terminu przed wyslaniem ekipy.',
        status: 'open',
        created_at: new Date(Date.now() - 45 * 60000).toISOString(),
        autor: 'Test Specjalista Wyceny',
      },
    ];
  }
  return [];
}

function getStoredTestUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
}

function normalizeRole(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isSalesDirectorRole(role) {
  const normalized = normalizeRole(role);
  return normalized.includes('dyrektor') && normalized.includes('sprzedaz');
}

function canSeeAllBranches(user) {
  const role = normalizeRole(user?.rola);
  return ['prezes', 'dyrektor', 'administrator'].includes(role) || isSalesDirectorRole(user?.rola);
}

function scopeMockTasks(tasks, user) {
  if (!user || canSeeAllBranches(user)) return tasks;
  if (user.oddzial_id == null) return tasks;
  return tasks.filter((task) => Number(task.oddzial_id) === Number(user.oddzial_id));
}

function scopeMockUsers(users, user) {
  if (!user) return users;
  if (isSalesDirectorRole(user.rola)) {
    return users.filter((row) => row.rola === 'Specjalista' || Number(row.id) === Number(user.id));
  }
  if (canSeeAllBranches(user)) return users;
  if (user.oddzial_id == null) return users;
  return users.filter((row) => Number(row.oddzial_id) === Number(user.oddzial_id));
}

export function getMockData(endpoint) {
  const currentUser = getStoredTestUser();
  const visibleTasks = scopeMockTasks(getMockTasksWithOverrides(), currentUser);
  const taskStats = visibleTasks.reduce((acc, task) => {
    const status = String(task.status || 'Nowe');
    if (status === 'Nowe') acc.nowe += 1;
    if (status === 'W_Realizacji' || status === 'W realizacji') acc.w_realizacji += 1;
    if (status === 'Zakonczone' || status === 'Zakończone') acc.zakonczone += 1;
    return acc;
  }, { nowe: 0, w_realizacji: 0, zakonczone: 0 });
  const rankingRows = [
    {
      ekipa_id: 5,
      ekipa_nazwa: 'Ekipa A',
      oddzial_nazwa: 'Krakow',
      ekipa_oddzial_nazwa: 'Krakow',
      zadania: 6,
      wartosc: 18400,
      skutecznosc: 83,
      score: 186,
      delegowane_zadania: 0,
    },
  ];
  const rankingBrygad = {
    generated_at: new Date().toISOString(),
    as_of: new Date().toISOString().slice(0, 10),
    oddzial_id: null,
    periods: {
      week: {
        key: 'week',
        label: 'Najlepsza ekipa tygodnia',
        from: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
        to: new Date().toISOString().slice(0, 10),
        winner: {
          rank: 1, team_id: 5, ekipa_nazwa: 'Ekipa A', oddzial_nazwa: 'Krakow', brygadzista_nazwa: 'Test Brygadzista',
          score: 186, total_tasks: 6, completed_tasks: 5, completion_rate: 83, revenue: 18400, logged_hours: 28, planned_hours: 30, photos_count: 18, issues_count: 1,
        },
        items: [
          { rank: 1, team_id: 5, ekipa_nazwa: 'Ekipa A', oddzial_nazwa: 'Krakow', score: 186, total_tasks: 6, completed_tasks: 5, revenue: 18400, logged_hours: 28, planned_hours: 30, photos_count: 18, issues_count: 1 },
        ],
      },
      month: { key: 'month', label: 'Najlepsza ekipa miesiaca', from: new Date().toISOString().slice(0, 8) + '01', to: new Date().toISOString().slice(0, 10), winner: null, items: [] },
      half_year: { key: 'half_year', label: 'Najlepsza ekipa polrocza', from: new Date().toISOString().slice(0, 5) + '01-01', to: new Date().toISOString().slice(0, 10), winner: null, items: [] },
      year: { key: 'year', label: 'Najlepsza ekipa roku', from: new Date().toISOString().slice(0, 5) + '01-01', to: new Date().toISOString().slice(0, 10), winner: null, items: [] },
    },
  };
  const digestDate = new Date().toISOString().slice(0, 10);
  const mapping = {
    '/tasks': visibleTasks,
    '/zlecenia': visibleTasks,
    '/tasks/wszystkie': visibleTasks,
    '/tasks/stats': taskStats,
    '/oddzialy': MOCK_DATA.oddzialy,
    '/ekipy': MOCK_DATA.ekipy,
    '/flota/sprzet': [],
    '/flota/rezerwacje': [],
    '/tasks/client-contacts': { contacts: {} },
    '/tasks/closure-events': { events: {} },
    '/notifications': { notifications: [], unread_count: 0 },
    '/ekipy/ranking': {
      month: { ranking: rankingRows },
      weeks: [{ week_start: new Date().toISOString().slice(0, 10), ranking: rankingRows }],
    },
    '/ekipy/live-locations': { items: MOCK_DATA.liveLocations, count: MOCK_DATA.liveLocations.length },
    '/uzytkownicy': scopeMockUsers(MOCK_DATA.uzytkownicy, currentUser),
    '/wyceny': MOCK_DATA.wyceny,
    '/payroll/month-close-status': { export_allowed: true, pending_count: 0 },
    '/raporty/ranking-brygad': rankingBrygad,
    '/ai/dispatch-brief': {
      source: 'rules',
      date: digestDate,
      summary: 'Testowy dyspozytor wskazuje najpierw blokady danych, potem trasy.',
      metrics: {
        tasks_total: 5,
        ready_for_dispatch: 3,
        blocked: 2,
        warnings: 2,
        overdue: 1,
        unassigned: 1,
        missing_gps: 1,
        low_margin: 1,
        teams_available: 2,
        total_value: 18400,
        avg_quality: 76,
      },
      recommendations: [
        {
          priority: 'high',
          title: 'Napraw 2 zlecenia przed solverem',
          rationale: 'Braki krytyczne w danych moga zablokowac dobry plan dnia.',
          suggested_action: 'Uzupelnij telefon, termin i zakres w zleceniach o najnizszej jakosci.',
          risk: 'high',
        },
        {
          priority: 'medium',
          title: 'Dodaj pinezke GPS do adresu',
          rationale: 'Bez wspolrzednych solver bazuje na przyblizeniach trasy.',
          suggested_action: 'Otworz ryzykowne zlecenie i ustaw pin lokalizacji.',
          risk: 'medium',
        },
      ],
      top_tasks: [
        {
          task_id: 102,
          task_numer: 'TEST-102',
          client: 'Wspolnota Zielona 8',
          status: 'Wycena_Terenowa',
          quality_score: 48,
          issues: [
            { key: 'price', severity: 'critical', label: 'Brak ceny', action: 'Uzupelnij cene przed planowaniem.' },
            { key: 'duration', severity: 'critical', label: 'Brak czasu', action: 'Dodaj planowany czas pracy.' },
          ],
        },
        {
          task_id: 103,
          task_numer: 'TEST-103',
          client: 'Osiedle Lesne Tarasy',
          status: 'Do_Zatwierdzenia',
          quality_score: 84,
          issues: [
            { key: 'gps', severity: 'warning', label: 'Brak pinezki GPS', action: 'Dodaj pinezke lokalizacji.' },
          ],
        },
      ],
    },
  };
  return mapping[endpoint] ?? null;
}
