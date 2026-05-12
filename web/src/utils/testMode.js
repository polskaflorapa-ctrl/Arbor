/**
 * Test mode utilities dla web aplikacji.
 * Włącz: REACT_APP_TEST_MODE=true w .env lub przez dev panel
 */

const TEST_MODE_STORAGE_KEY = 'arbor-test-mode';

// Testowi użytkownicy o różnych rolach
export const TEST_USERS = {
  prezes: {
    id: 9000,
    imie: 'Test',
    nazwisko: 'Prezes',
    email: 'prezes@test.local',
    rola: 'Prezes',
    oddzial_id: 1,
  },
  dyrektor: {
    id: 9001,
    imie: 'Test',
    nazwisko: 'Dyrektor',
    email: 'dyrektor@test.local',
    rola: 'Dyrektor',
    oddzial_id: 1,
  },
  dyrektorSprzedazy: {
    id: 9010,
    imie: 'Test',
    nazwisko: 'Dyrektor Sprzedaży',
    email: 'sprzedaz@test.local',
    rola: 'Dyrektor Sprzedaży',
    oddzial_id: 1,
  },
  specjalistaWroclaw: {
    id: 9011,
    login: 'spec-wro',
    imie: 'Test',
    nazwisko: 'Specjalista Wroclaw',
    email: 'spec.wro@test.local',
    rola: 'Specjalista',
    oddzial_id: 3,
    oddzial_nazwa: 'Oddzial Wroclaw',
    aktywny: true,
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
    nazwisko: 'Wyceniający',
    email: 'wyceniajacy@test.local',
    rola: 'Wyceniający',
    oddzial_id: 1,
  },
};

// Token testowy (nie będzie walidowany w trybie testowym)
export const TEST_TOKEN = 'test_token_' + Math.random().toString(36).substr(2, 9);
const MOCK_NOW = new Date();
const MOCK_YEAR = MOCK_NOW.getFullYear();
const MOCK_MONTH = MOCK_NOW.getMonth() + 1;
const mockPad2 = (n) => String(n).padStart(2, '0');
const mockIsoDay = (day) => `${MOCK_YEAR}-${mockPad2(MOCK_MONTH)}-${mockPad2(day)}T08:00:00.000Z`;

// Makiety danych dla API
export const MOCK_DATA = {
  zlecenia: [
    {
      id: 1,
      klient_nazwa: 'Test Klient 1',
      adres: 'ul. Testowa 1, 00-001 Warszawa',
      miasto: 'Warszawa',
      typ_uslugi: 'Inspekcja',
      status: 'Nowe',
      oddzial_id: 1,
      data_zaplanowana: mockIsoDay(2),
      data_planowana: mockIsoDay(2),
      brygadzista_id: 9003,
      ekipa_id: 6,
      ekipa_nazwa: 'Ekipa Warszawa B',
      wartosc_planowana: 8000,
      czas_planowany_godziny: 4,
      opis: 'Testowe zlecenie 1',
    },
    {
      id: 2,
      klient_nazwa: 'Test Klient 2',
      adres: 'ul. Testowa 2, 00-002 Kraków',
      miasto: 'Kraków',
      typ_uslugi: 'Konsultacja',
      status: 'W_Realizacji',
      oddzial_id: 2,
      data_zaplanowana: mockIsoDay(9),
      data_planowana: mockIsoDay(9),
      brygadzista_id: 9003,
      ekipa_id: 5,
      ekipa_nazwa: 'Ekipa Krakow A',
      wartosc_planowana: 12500,
      czas_planowany_godziny: 6,
      opis: 'Testowe zlecenie 2',
    },
    {
      id: 3,
      klient_nazwa: 'Test Klient 3',
      adres: 'ul. Testowa 3, 50-001 Wrocław',
      miasto: 'Wrocław',
      typ_uslugi: 'Wycinka',
      status: 'Zaplanowane',
      oddzial_id: 3,
      data_zaplanowana: mockIsoDay(16),
      data_planowana: mockIsoDay(16),
      brygadzista_id: null,
      ekipa_id: 7,
      ekipa_nazwa: 'Ekipa Wroclaw',
      wartosc_planowana: 11000,
      czas_planowany_godziny: 5,
      opis: 'Testowe zlecenie Wrocław',
    },
    {
      id: 4,
      klient_nazwa: 'Test Klient 4',
      adres: 'ul. Testowa 4, 00-004 Warszawa',
      miasto: 'Warszawa',
      typ_uslugi: 'Wycinka',
      status: 'Zakonczone',
      oddzial_id: 1,
      data_zaplanowana: mockIsoDay(4),
      data_planowana: mockIsoDay(4),
      data_wykonania: mockIsoDay(4),
      ekipa_id: 6,
      ekipa_nazwa: 'Ekipa Warszawa B',
      wartosc_planowana: 21000,
      wartosc_rzeczywista: 22500,
      czas_planowany_godziny: 8,
      opis: 'Zakonczone zlecenie rankingowe',
    },
    {
      id: 5,
      klient_nazwa: 'Test Klient 5',
      adres: 'ul. Testowa 5, 50-005 Wroclaw',
      miasto: 'Wroclaw',
      typ_uslugi: 'Pielegnacja',
      status: 'Zakonczone',
      oddzial_id: 3,
      data_zaplanowana: mockIsoDay(11),
      data_planowana: mockIsoDay(11),
      data_wykonania: mockIsoDay(11),
      ekipa_id: 7,
      ekipa_nazwa: 'Ekipa Wroclaw',
      wartosc_planowana: 14000,
      wartosc_rzeczywista: 14000,
      czas_planowany_godziny: 5,
      opis: 'Zakonczone zlecenie rankingowe',
    },
    {
      id: 6,
      klient_nazwa: 'Test Klient 6',
      adres: 'ul. Testowa 6, 30-006 Krakow',
      miasto: 'Krakow',
      typ_uslugi: 'Wycinka',
      status: 'Zakonczone',
      oddzial_id: 2,
      data_zaplanowana: mockIsoDay(18),
      data_planowana: mockIsoDay(18),
      data_wykonania: mockIsoDay(18),
      ekipa_id: 5,
      ekipa_nazwa: 'Ekipa Krakow A',
      wartosc_planowana: 9000,
      wartosc_rzeczywista: 9300,
      czas_planowany_godziny: 4,
      opis: 'Zakonczone zlecenie rankingowe',
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
      nazwa: 'Oddział Wrocław',
      adres: 'ul. Główna 3, 50-001 Wrocław',
      telefon: '+48 71 222 33 44',
      kierownik_id: null,
    },
  ],
  ekipy: [
    {
      id: 5,
      nazwa: 'Ekipa Krakow A',
      brygadzista_id: 9003,
      oddzial_id: 2,
      oddzial_nazwa: 'Oddzial Krakow',
      kolor: '#22C55E',
      pracownicy: [9003, 9006, 9007],
    },
    {
      id: 6,
      nazwa: 'Ekipa Warszawa B',
      brygadzista_id: null,
      oddzial_id: 1,
      oddzial_nazwa: 'Oddzial Warszawa',
      kolor: '#3B82F6',
      pracownicy: [],
    },
    {
      id: 7,
      nazwa: 'Ekipa Wroclaw',
      brygadzista_id: null,
      oddzial_id: 3,
      oddzial_nazwa: 'Oddzial Wroclaw',
      kolor: '#22D3EE',
      pracownicy: [],
    },
  ],
  uzytkownicy: [
    {
      ...TEST_USERS.prezes,
      login: 'prezes',
      oddzial_nazwa: 'Oddzial Warszawa',
      aktywny: true,
    },
    {
      ...TEST_USERS.dyrektor,
      login: 'dyrektor',
      oddzial_nazwa: 'Oddzial Warszawa',
      aktywny: true,
    },
    {
      ...TEST_USERS.dyrektorSprzedazy,
      login: 'dyrektor-sprzedazy',
      oddzial_nazwa: 'Oddzial Warszawa',
      aktywny: true,
    },
    {
      ...TEST_USERS.kierownik,
      login: 'kierownik',
      oddzial_nazwa: 'Oddzial Krakow',
      aktywny: true,
    },
    {
      id: 9011,
      login: 'spec-wro',
      imie: 'Test',
      nazwisko: 'Specjalista Wrocław',
      email: 'spec.wro@test.local',
      rola: 'Specjalista',
      oddzial_id: 3,
      oddzial_nazwa: 'Oddział Wrocław',
      aktywny: true,
    },
    {
      id: 9008,
      login: 'spec-waw',
      imie: 'Test',
      nazwisko: 'Specjalista Warszawa',
      email: 'spec.waw@test.local',
      rola: 'Specjalista',
      oddzial_id: 1,
      oddzial_nazwa: 'Oddzial Warszawa',
      aktywny: true,
    },
    {
      id: 9009,
      login: 'spec-krk',
      imie: 'Test',
      nazwisko: 'Specjalista Krakow',
      email: 'spec.krk@test.local',
      rola: 'Specjalista',
      oddzial_id: 2,
      oddzial_nazwa: 'Oddzial Krakow',
      aktywny: true,
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

export function mockMarkTaskFinishedInTestMode(taskId) {
  mockFinishedTaskIds.add(Number(taskId));
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
  return process.env.REACT_APP_TEST_MODE === 'true';
}

/**
 * Przełącza tryb testowy (w localStorage).
 */
export function toggleTestMode(enabled) {
  localStorage.setItem(TEST_MODE_STORAGE_KEY, String(enabled));
  if (!enabled) {
    mockFinishedTaskIds.clear();
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
  return {
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
}

/** Jeden otwarty wpis czasu — wymagany przez POST /tasks/:id/finish na OS. Po mock finish — wpis zamknięty. */
export function getMockTaskLogi(taskId) {
  const id = Number(taskId);
  if (mockFinishedTaskIds.has(id)) {
    return [
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

const SALES_DIRECTOR_ROLES = [
  'Dyrektor Sprzedazy',
  'Dyrektor Sprzedaży',
  'Dyrektor dzialu sprzedaz',
  'Dyrektor działu sprzedaż',
];

function readCurrentMockUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
}

function canSeeAllMockTasks(user) {
  return ['Prezes', 'Dyrektor'].includes(user?.rola) || SALES_DIRECTOR_ROLES.includes(user?.rola);
}

function getVisibleMockTasks(endpoint) {
  const user = readCurrentMockUser();
  const rows = MOCK_DATA.zlecenia;
  if (endpoint === '/tasks/wszystkie' && canSeeAllMockTasks(user)) return rows;
  if (endpoint === '/tasks/moje' && user?.ekipa_id) {
    return rows.filter((z) => Number(z.ekipa_id) === Number(user.ekipa_id));
  }
  if (canSeeAllMockTasks(user)) return rows;
  if (user?.rola === 'Kierownik' || user?.rola === 'Specjalista') {
    return rows.filter((z) => Number(z.oddzial_id) === Number(user.oddzial_id));
  }
  if (user?.ekipa_id) {
    return rows.filter((z) => Number(z.ekipa_id) === Number(user.ekipa_id));
  }
  if (user?.oddzial_id != null) {
    return rows.filter((z) => Number(z.oddzial_id) === Number(user.oddzial_id));
  }
  return [];
}

function getMockTaskStats() {
  const rows = getVisibleMockTasks('/tasks');
  return {
    nowe: rows.filter((z) => z.status === 'Nowe').length,
    w_realizacji: rows.filter((z) => z.status === 'W_Realizacji').length,
    zakonczone: rows.filter((z) => z.status === 'Zakonczone').length,
  };
}

function mockDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function mockYmd(year, month, day) {
  return `${year}-${mockPad2(month)}-${mockPad2(day)}`;
}

function mockDateKey(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function mockPeriodLabel(start, end) {
  return `${start.slice(8, 10)}-${end.slice(8, 10)}.${start.slice(5, 7)}`;
}

function buildMockRankingForPeriod(tasks, start, end) {
  const buckets = new Map();
  for (const task of tasks) {
    const dateKey = mockDateKey(task.data_wykonania || task.data_planowana || task.data_zaplanowana);
    const teamId = Number(task.ekipa_id);
    if (!dateKey || !teamId || dateKey < start || dateKey > end) continue;
    const team = MOCK_DATA.ekipy.find((e) => Number(e.id) === teamId);
    const oddzial = MOCK_DATA.oddzialy.find((o) => Number(o.id) === Number(team?.oddzial_id || task.oddzial_id));
    if (!buckets.has(teamId)) {
      buckets.set(teamId, {
        ekipa_id: teamId,
        ekipa_nazwa: task.ekipa_nazwa || team?.nazwa || `Ekipa #${teamId}`,
        oddzial_id: team?.oddzial_id || task.oddzial_id || null,
        oddzial_nazwa: oddzial?.nazwa || team?.oddzial_nazwa || null,
        zadania: 0,
        zakonczone: 0,
        w_realizacji: 0,
        zaplanowane: 0,
        wartosc: 0,
        godziny_planowane: 0,
        score_raw: 0,
      });
    }
    const row = buckets.get(teamId);
    const value = Number(task.wartosc_rzeczywista ?? task.wartosc_planowana ?? 0) || 0;
    const hours = Number(task.czas_planowany_godziny ?? 0) || 0;
    row.zadania += 1;
    row.wartosc += value;
    row.godziny_planowane += hours;
    if (String(task.status || '').toLowerCase().includes('zakoncz')) {
      row.zakonczone += 1;
      row.score_raw += 100;
    } else if (String(task.status || '').toLowerCase().includes('realizacji')) {
      row.w_realizacji += 1;
      row.score_raw += 35;
    } else {
      row.zaplanowane += 1;
      row.score_raw += 15;
    }
    row.score_raw += value / 1000;
    row.score_raw += hours * 2;
  }
  return Array.from(buckets.values())
    .map((row) => ({
      ...row,
      wartosc: Math.round(row.wartosc * 100) / 100,
      godziny_planowane: Math.round(row.godziny_planowane * 10) / 10,
      skutecznosc: row.zadania ? Math.round((row.zakonczone / row.zadania) * 100) : 0,
      score: Math.round(row.score_raw * 10) / 10,
    }))
    .sort((a, b) => b.score - a.score || b.zakonczone - a.zakonczone || b.wartosc - a.wartosc)
    .map((row, index) => ({ ...row, miejsce: index + 1 }));
}

export function getMockTeamRanking(params = {}) {
  const year = Number(params.rok) || MOCK_YEAR;
  const month = Number(params.miesiac) || MOCK_MONTH;
  const oddzialId = Number(params.oddzial_id) || null;
  let rows = getVisibleMockTasks('/tasks').filter((task) => task.ekipa_id);
  if (oddzialId) rows = rows.filter((task) => Number(task.oddzial_id) === oddzialId);
  const monthStart = mockYmd(year, month, 1);
  const monthEnd = mockYmd(year, month, mockDaysInMonth(year, month));
  const halfStartMonth = month <= 6 ? 1 : 7;
  const halfEndMonth = month <= 6 ? 6 : 12;
  const halfStart = mockYmd(year, halfStartMonth, 1);
  const halfEnd = mockYmd(year, halfEndMonth, mockDaysInMonth(year, halfEndMonth));
  const yearStart = mockYmd(year, 1, 1);
  const yearEnd = mockYmd(year, 12, 31);
  const weeks = [];
  for (let day = 1, idx = 1; day <= mockDaysInMonth(year, month); day += 7, idx += 1) {
    const start = mockYmd(year, month, day);
    const end = mockYmd(year, month, Math.min(day + 6, mockDaysInMonth(year, month)));
    const ranking = buildMockRankingForPeriod(rows, start, end);
    weeks.push({ key: `week-${idx}`, label: `Tydzien ${idx} (${mockPeriodLabel(start, end)})`, start, end, winner: ranking[0] || null, ranking });
  }
  const monthRanking = buildMockRankingForPeriod(rows, monthStart, monthEnd);
  const halfYearRanking = buildMockRankingForPeriod(rows, halfStart, halfEnd);
  const yearRanking = buildMockRankingForPeriod(rows, yearStart, yearEnd);
  const oddzial = MOCK_DATA.oddzialy.find((o) => Number(o.id) === oddzialId);
  return {
    rok: year,
    miesiac: month,
    generated_at: new Date().toISOString(),
    scope: { oddzial_id: oddzialId, oddzial_nazwa: oddzial?.nazwa || null },
    weeks,
    month: { label: `Miesiac ${mockPad2(month)}.${year}`, start: monthStart, end: monthEnd, winner: monthRanking[0] || null, ranking: monthRanking },
    halfYear: { label: `${month <= 6 ? 'I' : 'II'} polrocze ${year}`, start: halfStart, end: halfEnd, winner: halfYearRanking[0] || null, ranking: halfYearRanking },
    year: { label: `Rok ${year}`, start: yearStart, end: yearEnd, winner: yearRanking[0] || null, ranking: yearRanking },
  };
}

function getVisibleMockUsers() {
  const user = readCurrentMockUser();
  const rows = MOCK_DATA.uzytkownicy;
  if (['Prezes', 'Dyrektor'].includes(user?.rola)) return rows;
  if (SALES_DIRECTOR_ROLES.includes(user?.rola)) {
    return rows.filter((u) => u.rola === 'Specjalista' || Number(u.id) === Number(user.id));
  }
  if (user?.oddzial_id != null) {
    return rows.filter((u) => Number(u.oddzial_id) === Number(user.oddzial_id));
  }
  return rows.filter((u) => Number(u.id) === Number(user?.id));
}

/**
 * Przygotowuje mockowe dane dla API (dokładne dopasowanie ścieżki).
 */
export function getMockData(endpoint) {
  const mapping = {
    '/zlecenia': getVisibleMockTasks('/tasks'),
    '/tasks/wszystkie': getVisibleMockTasks('/tasks/wszystkie'),
    '/tasks': getVisibleMockTasks('/tasks'),
    '/tasks/moje': getVisibleMockTasks('/tasks/moje'),
    '/tasks/stats': getMockTaskStats(),
    '/ekipy/ranking': getMockTeamRanking(),
    '/payroll/month-close-status': { export_allowed: true, pending_count: 0 },
    '/notifications': { notifications: [], unread_count: 0 },
    '/uzytkownicy': getVisibleMockUsers(),
    '/oddzialy': MOCK_DATA.oddzialy,
    '/ekipy': MOCK_DATA.ekipy,
    '/wyceny': MOCK_DATA.wyceny,
  };
  return mapping[endpoint] ?? null;
}
