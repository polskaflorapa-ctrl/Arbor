/**
 * Test mode utilities dla aplikacji mobilnej (React Native/Expo).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { API_URL } from '../constants/api';

const TEST_MODE_STORAGE_KEY = 'arbor-mobile-test-mode';
const TEST_USER_STORAGE_KEY = 'arbor-mobile-test-user';

// Testowi użytkownicy o różnych rolach
export const TEST_USERS_MOBILE = {
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
    nazwisko: 'Wyceniający',
    email: 'wyceniajacy@test.local',
    rola: 'Wyceniający',
    oddzial_id: 1,
  },
};

// Token testowy
export const TEST_TOKEN_MOBILE = 'test_token_mobile_' + Math.random().toString(36).substr(2, 9);

// Makiety danych dla API
export const MOCK_DATA_MOBILE = {
  zlecenia: [
    {
      id: 1,
      klient_nazwa: 'Test Klient 1',
      adres: 'ul. Testowa 1, 00-001 Warszawa',
      miasto: 'Warszawa',
      typ_uslugi: 'Inspekcja',
      status: 'Nowe',
      data_planowana: new Date().toISOString(),
      data_zaplanowana: new Date().toISOString(),
      brygadzista_id: 9003,
      ekipa_id: 5,
      opis: 'Testowe zlecenie 1',
      created_at: new Date().toISOString(),
    },
    {
      id: 2,
      klient_nazwa: 'Test Klient 2',
      adres: 'ul. Testowa 2, 00-002 Kraków',
      miasto: 'Kraków',
      typ_uslugi: 'Konsultacja',
      status: 'W realizacji',
      data_planowana: new Date(Date.now() - 86400000).toISOString(),
      data_zaplanowana: new Date(Date.now() - 86400000).toISOString(),
      brygadzista_id: 9003,
      ekipa_id: 5,
      opis: 'Testowe zlecenie 2',
      created_at: new Date(Date.now() - 172800000).toISOString(),
    },
  ],
  dashboard: {
    zlecenia_nowe: 2,
    zlecenia_w_realizacji: 1,
    zlecenia_ukonczone_dzisiaj: 0,
    zespoly_aktywne: 1,
    sr_zadowolenie: 4.7,
  },
  tasks: [
    {
      id: 1,
      klient_nazwa: 'Test Klient 1',
      adres: 'ul. Testowa 1',
      miasto: 'Krakow',
      typ_uslugi: 'Inspekcja',
      status: 'Nowe',
      data_planowana: new Date().toISOString(),
      brygadzista_id: 9003,
      ekipa_id: 5,
      ekipa_nazwa: 'Ekipa A',
      ankieta_uproszczona: true,
      czas_planowany_godziny: 3,
      wartosc_planowana: 2450,
      notatki_wewnetrzne: [
        'TRYB TERENOWY: szybka wycena u klienta',
        'PRZEKAZANIE DO BIURA',
        'Gotowosc: 5/5',
        'FORMULARZ WYCENY TERENOWEJ',
        'Zakres prac: przycinka koron, wywoz galezi',
        'Sprzet: rebak, pilarka, lina',
        'Ryzyka: ogrodzenie, linia nad wjazdem',
        'Dostep / parking: brama od ulicy, miejsce dla busa przy posesji',
      ].join('\n'),
      photo_total: 3,
      photo_wycena: 1,
      photo_szkic: 1,
      photo_dojazd: 1,
    },
    {
      id: 2,
      klient_nazwa: 'Test Klient 2',
      adres: 'ul. Testowa 2',
      miasto: 'Krakow',
      typ_uslugi: 'Konsultacja',
      status: 'W_Realizacji',
      data_planowana: new Date(Date.now() - 86400000).toISOString(),
      brygadzista_id: 9003,
      ekipa_id: 5,
      ekipa_nazwa: 'Ekipa A',
      ankieta_uproszczona: true,
      czas_planowany_godziny: 2,
      notatki_wewnetrzne: [
        'TRYB TERENOWY: szybka wycena u klienta',
        'PRZEKAZANIE DO BIURA',
        'Gotowosc: 3/5',
        'FORMULARZ WYCENY TERENOWEJ',
        'Zakres prac: usuniecie suchej galezi nad podjazdem',
        'Ryzyka: auto klienta, waski dojazd',
      ].join('\n'),
      photo_total: 1,
      photo_wycena: 1,
      photo_szkic: 0,
      photo_dojazd: 0,
    },
  ],
  taskPhotos: {
    '1': [
      {
        id: 101,
        task_id: 1,
        typ: 'wycena',
        opis: 'Widok ogolny drzewa i zakresu.',
        url: '/uploads/tasks/mock-wycena.jpg',
        created_at: new Date().toISOString(),
        lokalizacja: '50.06143, 19.93658',
      },
      {
        id: 102,
        task_id: 1,
        typ: 'szkic',
        opis: 'Szkic ciecia koron przy ogrodzeniu.',
        url: '/uploads/tasks/mock-szkic.jpg',
        created_at: new Date().toISOString(),
      },
      {
        id: 103,
        task_id: 1,
        typ: 'dojazd',
        opis: 'Dojazd i brama wjazdowa dla ekipy.',
        url: '/uploads/tasks/mock-dojazd.jpg',
        created_at: new Date().toISOString(),
        lokalizacja: '50.06143, 19.93658',
      },
    ],
    '2': [
      {
        id: 201,
        task_id: 2,
        typ: 'wycena',
        opis: 'Zdjecie ogolne miejsca pracy. Brakuje szkicu i dojazdu.',
        url: '/uploads/tasks/mock-brak-szkicu.jpg',
        created_at: new Date(Date.now() - 86400000).toISOString(),
      },
    ],
  },
  tasksStats: {
    nowe: 2,
    w_realizacji: 1,
    zakonczone: 0,
    oczekujace: 0,
  },
  ekipy: [
    {
      id: 5,
      nazwa: 'Ekipa A',
      brygadzista_id: 9003,
      oddzial_id: 2,
      pracownicy: [9003, 9006, 9007],
      liczba_czlonkow: 3,
      zlecenia_dzien: 1,
      rezerwacje_wstepne_dzien: 0,
      zajete_minuty_dzien: 180,
      wolne_minuty_dzien: 300,
      planowane_godziny_dzien: 3,
      obciazenie_proc_dzien: 38,
      dostepnosc_dzien: 'czesciowa',
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
      kierownik_id: 9002,
    },
  ],
  uzytkownicy: [
    {
      id: 9001,
      imie: 'Test',
      nazwisko: 'Dyrektor',
      email: 'dyrektor@test.local',
      rola: 'Dyrektor',
    },
    {
      id: 9002,
      imie: 'Test',
      nazwisko: 'Kierownik',
      email: 'kierownik@test.local',
      rola: 'Kierownik',
    },
    {
      id: 9003,
      imie: 'Test',
      nazwisko: 'Brygadzista',
      email: 'brygadzista@test.local',
      rola: 'Brygadzista',
    },
  ],
  notifications: [
    {
      id: 'n1',
      title: 'Testowe powiadomienie',
      body: 'To jest testowe powiadomienie z trybu testowego.',
      date: new Date().toISOString(),
      read: false,
    },
  ],
  raportyMobilne: [
    {
      id: 1,
      data: new Date().toISOString().split('T')[0],
      status: 'Gotowe',
      liczba_zadan: 3,
    },
  ],
  flota: {
    pojazdy: [
      { id: 101, marka: 'Fiat', model: 'Doblo', nr_rejestracyjny: 'WA12345' },
    ],
    sprzet: [
      { id: 201, nazwa: 'Pompa', serial: 'P-0001' },
    ],
    naprawy: [
      { id: 301, pojazd_id: 101, opis: 'Wymiana oleju', status: 'Zaplanowane' },
    ],
  },
  wyceny: [],
  mobileReports: [],
  mobileConfig: {
    oddzialFeatureOverrides: {
      '1': { name: 'Warszawa', allowed: ['/dashboard', '/zlecenia'] },
      '2': { name: 'Kraków', allowed: ['/dashboard', '/zlecenia'] },
    },
    appFlags: {
      autoplanRelaxApplyRoles: false,
    },
  },
};
/**
 * Sprawdza czy tryb testowy jest włączony.
 */
export async function isTestModeEnabledMobile() {
  try {
    const stored = await AsyncStorage.getItem(TEST_MODE_STORAGE_KEY);
    return stored === 'true';
  } catch {
    return false;
  }
}

/**
 * Włącza/wyłącza tryb testowy.
 */
export async function toggleTestModeMobile(enabled: boolean) {
  try {
    await AsyncStorage.setItem(TEST_MODE_STORAGE_KEY, String(enabled));
  } catch (e) {
    console.error('Failed to toggle test mode:', e);
  }
}

export type MobileRoleKey = keyof typeof TEST_USERS_MOBILE;

/**
 * Zwraca testowego użytkownika.
 */
export function getTestUserMobile(role: MobileRoleKey) {
  const roleKey = Object.keys(TEST_USERS_MOBILE).find(
    (k) => TEST_USERS_MOBILE[k as MobileRoleKey].rola.toLowerCase() === (role || '').toLowerCase()
  ) as MobileRoleKey | undefined;
  return roleKey ? TEST_USERS_MOBILE[roleKey] : TEST_USERS_MOBILE.dyrektor;
}

/**
 * Zwraca testowy token.
 */
export function getTestTokenMobile() {
  return TEST_TOKEN_MOBILE;
}

/**
 * Zaloguj testowego użytkownika.
 */
export async function loginTestUserMobile(role: MobileRoleKey) {
  try {
    const user = getTestUserMobile(role);
    const token = TEST_TOKEN_MOBILE;
    
    await AsyncStorage.multiSet([
      ['token', token],
      ['user', JSON.stringify(user)],
      [TEST_MODE_STORAGE_KEY, 'true'],
      [TEST_USER_STORAGE_KEY, role],
    ]);
    
    return { token, user };
  } catch (e) {
    console.error('Failed to login test user:', e);
    return null;
  }
}

/**
 * Wyloguj testowego użytkownika.
 */
export async function logoutTestUserMobile() {
  try {
    await AsyncStorage.multiRemove([
      'token',
      'user',
      TEST_MODE_STORAGE_KEY,
      TEST_USER_STORAGE_KEY,
    ]);
  } catch (e) {
    console.error('Failed to logout test user:', e);
  }
}

export async function getCurrentTestUserMobile() {
  try {
    const storedRole = await AsyncStorage.getItem(TEST_USER_STORAGE_KEY);
    if (!storedRole) return null;
    return getTestUserMobile(storedRole as MobileRoleKey);
  } catch {
    return null;
  }
}

export async function getCurrentTestRoleMobile(): Promise<MobileRoleKey | null> {
  try {
    const storedRole = await AsyncStorage.getItem(TEST_USER_STORAGE_KEY);
    if (!storedRole) return null;
    return Object.keys(TEST_USERS_MOBILE).includes(storedRole)
      ? (storedRole as MobileRoleKey)
      : null;
  } catch {
    return null;
  }
}

function normalizeMobileApiPath(url: string | undefined) {
  if (!url) return '';
  try {
    const parsed = new URL(String(url), API_URL);
    return parsed.pathname.replace(/\/+$|\/\?+$/g, '');
  } catch {
    return String(url).split('?')[0].replace(/\/+$|\/\?+$/g, '');
  }
}

function safeParseJson(value: any) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function getIdFromPath(path: string, pattern: RegExp) {
  const match = path.match(pattern);
  return match ? match[1] : null;
}

function getTestUserForLogin(login: string | undefined) {
  const normalized = String(login || '').trim().toLowerCase();
  if (normalized.includes('dyrektor')) return getTestUserMobile('dyrektor');
  if (normalized.includes('kierownik')) return getTestUserMobile('kierownik');
  if (normalized.includes('brygadzista')) return getTestUserMobile('brygadzista');
  if (normalized.includes('wyceniajacy') || normalized.includes('wyceniający')) return getTestUserMobile('wyceniajacy');
  return getTestUserMobile('dyrektor');
}

export async function getMockDataForMobileFetch(url: string | undefined, method = 'GET', body?: any) {
  const path = normalizeMobileApiPath(url);
  const verb = method.toUpperCase();

  if (verb === 'POST' && path === '/api/auth/login') {
    const parsedBody = safeParseJson(body);
    const loginData = parsedBody?.login || parsedBody?.email || undefined;
    return {
      token: TEST_TOKEN_MOBILE,
      user: getTestUserForLogin(loginData),
    };
  }

  if (path === '/api/auth/me') {
    const user = await getCurrentTestUserMobile();
    return user ? { user } : null;
  }

  if (path === '/api/mobile-config' || path === '/api/config/mobile') {
    return MOCK_DATA_MOBILE.mobileConfig;
  }

  if (path === '/api/mobile/me/push-token' || path === '/api/mobile/me/team-day-close') {
    return { ok: true };
  }

  if (path === '/api/tasks/wszystkie' || path === '/api/tasks/moje') {
    return MOCK_DATA_MOBILE.tasks;
  }

  if (path === '/api/tasks/stats') {
    return MOCK_DATA_MOBILE.tasksStats;
  }

  if (path === '/api/ekipy') {
    return MOCK_DATA_MOBILE.ekipy;
  }

  if (path === '/api/ekipy/live-locations') {
    return [];
  }

  if (path === '/api/oddzialy') {
    return MOCK_DATA_MOBILE.oddzialy;
  }

  if (path === '/api/uzytkownicy') {
    return MOCK_DATA_MOBILE.uzytkownicy;
  }

  if (path === '/api/notifications') {
    return MOCK_DATA_MOBILE.notifications;
  }

  if (path === '/api/raporty/mobile') {
    return MOCK_DATA_MOBILE.raportyMobilne;
  }

  if (path === '/api/raporty/ranking-brygad') {
    const today = new Date().toISOString().slice(0, 10);
    const winner = {
      rank: 1,
      team_id: 5,
      ekipa_id: 5,
      ekipa_nazwa: 'Ekipa A',
      oddzial_nazwa: 'Kraków',
      brygadzista_nazwa: 'Test Brygadzista',
      score: 186,
      total_tasks: 6,
      completed_tasks: 5,
      completion_rate: 83,
      revenue: 18400,
      logged_hours: 28,
      planned_hours: 30,
      photos_count: 18,
      issues_count: 1,
    };
    return {
      generated_at: new Date().toISOString(),
      as_of: today,
      oddzial_id: 2,
      periods: {
        week: { key: 'week', label: 'Najlepsza ekipa tygodnia', from: today, to: today, winner, items: [winner] },
        month: { key: 'month', label: 'Najlepsza ekipa miesiaca', from: `${today.slice(0, 8)}01`, to: today, winner, items: [winner] },
        half_year: { key: 'half_year', label: 'Najlepsza ekipa polrocza', from: `${today.slice(0, 5)}01-01`, to: today, winner, items: [winner] },
        year: { key: 'year', label: 'Najlepsza ekipa roku', from: `${today.slice(0, 5)}01-01`, to: today, winner, items: [winner] },
      },
    };
  }

  if (path === '/api/flota/pojazdy') {
    return MOCK_DATA_MOBILE.flota.pojazdy;
  }

  if (path === '/api/flota/sprzet') {
    return MOCK_DATA_MOBILE.flota.sprzet;
  }

  if (path === '/api/flota/naprawy') {
    return MOCK_DATA_MOBILE.flota.naprawy;
  }

  if (path === '/api/wyceny') {
    return MOCK_DATA_MOBILE.wyceny ?? [];
  }

  if (path === '/api/mobile/reports') {
    return MOCK_DATA_MOBILE.mobileReports ?? [];
  }

  if (path === '/api/tasks/nowe') {
    return MOCK_DATA_MOBILE.tasks;
  }

  if (path === '/api/auth/pomocnicy') {
    return [];
  }

  if (path === '/api/mobile/me/settlements-overview') {
    return {};
  }

  if (/^\/api\/ogledziny(?:\/\d+)?(?:\/media)?$/.test(path)) {
    return [];
  }

  if (/^\/api\/tasks\/\d+\/logi$/.test(path)) {
    return [];
  }

  if (/^\/api\/tasks\/\d+\/zdjecia$/.test(path)) {
    const taskId = getIdFromPath(path, /^\/api\/tasks\/(\d+)\/zdjecia$/);
    const photosByTask = MOCK_DATA_MOBILE.taskPhotos as Record<string, any[]>;
    return photosByTask[taskId || ''] ?? [];
  }

  if (path === '/api/cmr') {
    return {};
  }

  if (/^\/api\/raporty-dzienne(?:\/\d+)?$/.test(path)) {
    return verb === 'GET' ? [] : { ok: true };
  }

  if (/^\/api\/rozliczenia(?:\/.*)?$/.test(path)) {
    return verb === 'GET' ? [] : { ok: true };
  }

  if (/^\/api\/wyceny\/\d+\/zdjecia$/.test(path)) {
    return [];
  }

  if (/^\/api\/quotations(?:\/.*)?$/.test(path)) {
    return verb === 'GET' ? [] : { ok: true };
  }

  if (/^\/api\/wyceny\/availability\/slots/.test(path)) {
    return [];
  }

  if (/^\/api\/wyceny\/\d+\/(?:rezerwuj-termin|status|konwertuj)$/.test(path)) {
    return { ok: true };
  }

  if (/^\/api\/tasks\/\d+(?:\/.*)?$/.test(path)) {
    const taskId = getIdFromPath(path, /^\/api\/tasks\/(\d+)/);
    const task = MOCK_DATA_MOBILE.tasks.find((item) => String(item.id) === String(taskId));
    if (task) return task;
    return MOCK_DATA_MOBILE.tasks[0] ?? {};
  }

  if (/^\/api\/ekipy\/\d+$/.test(path)) {
    const ekipaId = getIdFromPath(path, /^\/api\/ekipy\/(\d+)$/);
    return MOCK_DATA_MOBILE.ekipy.find((item) => String(item.id) === String(ekipaId)) ?? MOCK_DATA_MOBILE.ekipy[0] ?? {};
  }

  if (/^\/api\/oddzialy\/\d+\/zasoby$/.test(path)) {
    const oddzialId = getIdFromPath(path, /^\/api\/oddzialy\/(\d+)\/zasoby$/);
    return {
      oddzial_id: oddzialId,
      date: new Date().toISOString().slice(0, 10),
      ekipy: MOCK_DATA_MOBILE.ekipy.filter((item) => String(item.oddzial_id) === String(oddzialId)),
      wyceniajacy: MOCK_DATA_MOBILE.uzytkownicy.filter(
        (item: any) => String(item.oddzial_id) === String(oddzialId) && String(item.rola || '').toLowerCase().includes('wyceniaj'),
      ),
    };
  }

  if (/^\/api\/oddzialy\/\d+$/.test(path)) {
    const oddzialId = getIdFromPath(path, /^\/api\/oddzialy\/(\d+)$/);
    return MOCK_DATA_MOBILE.oddzialy.find((item) => String(item.id) === String(oddzialId)) ?? MOCK_DATA_MOBILE.oddzialy[0] ?? {};
  }

  if (/^\/api\/uzytkownicy\/\d+$/.test(path)) {
    const userId = getIdFromPath(path, /^\/api\/uzytkownicy\/(\d+)$/);
    return MOCK_DATA_MOBILE.uzytkownicy.find((item) => String(item.id) === String(userId)) ?? MOCK_DATA_MOBILE.uzytkownicy[0] ?? {};
  }

  if (/^\/api\/(?:ogledziny|flota\/pojazdy|flota\/sprzet)\/\d+\/status$/.test(path)) {
    return { ok: true };
  }

  if (/^\/api\/flota\/rezerwacje(?:\/\d+\/status)?$/.test(path)) {
    return verb === 'GET' ? [] : { ok: true };
  }

  if (/^\/api\/(?:quotations|wyceny|raporty-dzienne|rozliczenia|auth\/pomocnicy)(?:\/.*)?$/.test(path)) {
    return verb === 'GET' ? [] : { ok: true };
  }

  const endpoint = path.replace(/^\/api/, '');
  const fallback = getMockDataMobile(endpoint);
  if (fallback !== null) return fallback;

  if (verb === 'GET') {
    return [];
  }

  return { ok: true };
}

export async function installMobileTestModeFetchInterceptor() {
  const isEnabled = await isTestModeEnabledMobile();
  if (!isEnabled) return;

  const originalFetch = global.fetch;
  if (typeof originalFetch !== 'function') return;
  if ((originalFetch as any).__testModePatched) return;

  const patchedFetch = async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input?.url;
    const method = (init?.method || (typeof input !== 'string' ? input.method : undefined) || 'GET') as string;
    const body = init?.body ?? (typeof input !== 'string' ? input.body : undefined);
    const mockResponse = await getMockDataForMobileFetch(url, method, body);
    if (mockResponse != null) {
      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(input, init);
  };

  (patchedFetch as any).__testModePatched = true;
  global.fetch = patchedFetch as typeof global.fetch;
}

export async function installMobileTestModeAxiosAdapter() {
  const isEnabled = await isTestModeEnabledMobile();
  if (!isEnabled) return;

  const currentAdapter = axios.defaults.adapter as any;
  if ((currentAdapter as any)?.__testModePatched) return;

  const originalAdapter =
    typeof currentAdapter === 'function'
      ? currentAdapter
      : typeof (axios as any).getAdapter === 'function'
        ? (axios as any).getAdapter(currentAdapter)
        : null;
  if (typeof originalAdapter !== 'function') return;

  axios.defaults.adapter = async (config: any) => {
    const mockData = await getMockDataForMobileFetch(
      config.url as string,
      (config.method || 'GET').toUpperCase(),
      config.data,
    );
    if (mockData != null) {
      return {
        data: mockData,
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
        request: {},
      };
    }
    return originalAdapter(config);
  };
  (axios.defaults.adapter as any).__testModePatched = true;
}

/**
 * Zwraca mockowe dane dla API.
 */
export function getMockDataMobile(endpoint: string) {
  const mapping: Record<string, unknown> = {
    '/zlecenia': MOCK_DATA_MOBILE.zlecenia,
    '/dashboard/summary': MOCK_DATA_MOBILE.dashboard,
  };
  return mapping[endpoint] ?? null;
}
