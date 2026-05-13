/**
 * Test mode utilities dla web aplikacji.
 * Włącz: REACT_APP_TEST_MODE=true w .env lub przez dev panel
 */

const TEST_MODE_STORAGE_KEY = 'arbor-test-mode';

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
    nazwisko: 'Wyceniający',
    email: 'wyceniajacy@test.local',
    rola: 'Wyceniający',
    oddzial_id: 1,
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
      photo_total: 0,
      photo_wycena: 0,
      photo_szkic: 0,
      photo_dojazd: 0,
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
      wyceniajacy_nazwa: 'Test Wyceniajacy',
      ekipa_id: '',
      wartosc_planowana: 0,
      czas_planowany_godziny: '',
      opis_pracy: 'Wyceniajacy ma zebrac zdjecia, zakres i cene u klienta.',
      photo_total: 2,
      photo_wycena: 1,
      photo_szkic: 0,
      photo_dojazd: 1,
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
      wyceniajacy_nazwa: 'Test Wyceniajacy',
      ekipa_id: 5,
      ekipa_nazwa: 'Ekipa A',
      wartosc_planowana: 2800,
      czas_planowany_godziny: 3,
      opis_pracy: 'Klient zaakceptowal zakres, biuro zatwierdza termin i ekipe.',
      photo_total: 5,
      photo_wycena: 2,
      photo_szkic: 2,
      photo_dojazd: 1,
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

/**
 * Przygotowuje mockowe dane dla API (dokładne dopasowanie ścieżki).
 */
export function getMockData(endpoint) {
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
  const mapping = {
    '/zlecenia': MOCK_DATA.zlecenia,
    '/tasks/wszystkie': MOCK_DATA.zlecenia,
    '/oddzialy': MOCK_DATA.oddzialy,
    '/ekipy': MOCK_DATA.ekipy,
    '/wyceny': MOCK_DATA.wyceny,
    '/raporty/ranking-brygad': rankingBrygad,
  };
  return mapping[endpoint] ?? null;
}
