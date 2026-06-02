import '../i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import Zlecenia from './Zlecenia';
import api from '../api';

vi.mock('../components/Sidebar', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../components/TelemetryStatus', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const USER_JSON = JSON.stringify({
  id: 9001,
  rola: 'Dyrektor',
  imie: 'Anna',
  nazwisko: 'Planer',
});

const scrollIntoViewMock = vi.fn();

const TASK = {
  id: 42,
  status: 'Do_Zatwierdzenia',
  klient_nazwa: 'Jan Kowalski',
  klient_telefon: '',
  klient_email: '',
  adres: 'Lesna 12',
  miasto: 'Wroclaw',
  typ_uslugi: 'Pielegnacja',
  oddzial_id: 7,
  data_planowana: '',
  godzina_rozpoczecia: '',
  wartosc_planowana: 2500,
  czas_planowany_godziny: 3,
  opis_pracy: 'Przycinka koron nad podjazdem',
  ekipa_id: '',
};

const SLOW_FORM_RENDER = { timeout: 10000 };

function gpsRows(date = '2026-05-26') {
  return [
    {
      provider: 'mobile',
      user_id: 9,
      user_name: 'Jan Brygadzista',
      lat: 51.1,
      lng: 17.03,
      speed_kmh: 12,
      accuracy_m: 8,
      recorded_at: `${date}T08:00:00`,
    },
    {
      provider: 'juwentus',
      nr_rejestracyjny: 'KR12345',
      lat: 51.12,
      lng: 17.06,
      speed_kmh: 38,
      accuracy_m: 5,
      recorded_at: `${date}T08:20:00`,
    },
  ];
}

function mockZleceniaApi(options = {}) {
  const task = options.task || TASK;
  const vehicles = options.vehicles || [];
  const equipment = options.equipment || [];
  const repairs = options.repairs || [];
  api.get.mockImplementation((url) => {
    if (url === '/tasks/wszystkie') return Promise.resolve({ data: [task] });
    if (url === '/tasks/42') return Promise.resolve({ data: task });
    if (url === '/ekipy') return Promise.resolve({ data: [{ id: 3, nazwa: 'Brygada Alfa', oddzial_id: 7 }] });
    if (url === '/uzytkownicy') return Promise.resolve({ data: [] });
    if (url === '/oddzialy') return Promise.resolve({ data: [{ id: 7, nazwa: 'Wroclaw' }] });
    if (url === '/flota/sprzet') return Promise.resolve({ data: equipment });
    if (url === '/flota/pojazdy') return Promise.resolve({ data: vehicles });
    if (url === '/flota/naprawy') return Promise.resolve({ data: repairs });
    if (url === '/tasks/client-contacts') return Promise.resolve({ data: null });
    if (url === '/tasks/closure-events') return Promise.resolve({ data: null });
    if (String(url).startsWith('/ekipy/gps-history?')) {
      const params = new URLSearchParams(String(url).split('?')[1]);
      const date = params.get('date') || '2026-05-26';
      return Promise.resolve({ data: { date, items: gpsRows(date), count: 2 } });
    }
    if (String(url).startsWith('/tasks/42/')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
}

function renderRoute(path) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/zlecenia/:id" element={<Zlecenia />} />
        <Route path="/auto-dispatch" element={<div>Powrot do AI Dyspozytora</div>} />
        <Route path="/harmonogram" element={<LocationProbe label="Harmonogram fokus" />} />
        <Route path="/flota" element={<LocationProbe label="Flota fokus" />} />
        <Route path="/ekipy" element={<LocationProbe label="Ekipy fokus" />} />
        <Route path="/" element={<div>Login</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function LocationProbe({ label }) {
  const location = useLocation();
  return <div data-testid="location-probe">{label}: {location.search}</div>;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'test-jwt');
  localStorage.setItem('user', USER_JSON);
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoViewMock,
  });
  scrollIntoViewMock.mockClear();
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.patch.mockReset();
  api.delete.mockReset();
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('opens routed repair links in edit mode and focuses the requested field', async () => {
  mockZleceniaApi();

  renderRoute('/zlecenia/42?mode=edit&step=client&field=klient_telefon&repairLabel=Brak%20telefonu&repairDetail=Dodaj%20numer%20telefonu%20klienta.');

  expect(await screen.findByText('Tryb naprawy', {}, SLOW_FORM_RENDER)).toBeInTheDocument();
  expect(screen.getByText('Brak telefonu')).toBeInTheDocument();
  expect(screen.getByText('Dodaj numer telefonu klienta.')).toBeInTheDocument();

  const phoneInput = screen.getByPlaceholderText('+48 000 000 000');
  expect(phoneInput).toHaveValue('');
  await waitFor(() => expect(document.activeElement).toBe(phoneInput));
}, 15000);

test('returns to dispatcher after saving a routed repair link', async () => {
  mockZleceniaApi();
  api.put.mockResolvedValue({
    data: {
      ...TASK,
      klient_telefon: '+48 600 700 800',
    },
  });

  renderRoute('/zlecenia/42?mode=edit&step=client&field=klient_telefon&repairLabel=Brak%20telefonu&repairDetail=Dodaj%20numer%20telefonu%20klienta.&returnTo=%2Fauto-dispatch&returnLabel=AI%20Dyspozytor');

  expect(await screen.findByText('Tryb naprawy', {}, SLOW_FORM_RENDER)).toBeInTheDocument();
  const returnButton = screen.getByRole('button', {
    name: (name) => name.includes('Zapisz') && name.includes('AI Dyspozytor'),
  });
  expect(returnButton).toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText('+48 000 000 000'), {
    target: { value: '+48 600 700 800' },
  });
  fireEvent.click(returnButton);

  await waitFor(() => {
    expect(api.put).toHaveBeenCalledWith(
      '/tasks/42',
      expect.objectContaining({ klient_telefon: '+48 600 700 800' }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  expect(await screen.findByText('Powrot do AI Dyspozytora', {}, SLOW_FORM_RENDER)).toBeInTheDocument();
}, 15000);

test('returns to a clean task card after saving a routed repair link', async () => {
  mockZleceniaApi();
  api.put.mockResolvedValue({
    data: {
      ...TASK,
      klient_telefon: '+48 600 700 800',
    },
  });

  renderRoute('/zlecenia/42?mode=edit&step=client&field=klient_telefon&repairLabel=Brak%20telefonu&repairDetail=Dodaj%20numer%20telefonu%20klienta.');

  expect(await screen.findByText('Tryb naprawy', {}, SLOW_FORM_RENDER)).toBeInTheDocument();
  const returnButton = screen.getByRole('button', {
    name: (name) => name.includes('Zapisz') && name.includes('karty'),
  });
  expect(returnButton).toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText('+48 000 000 000'), {
    target: { value: '+48 600 700 800' },
  });
  fireEvent.click(returnButton);

  await waitFor(() => {
    expect(api.put).toHaveBeenCalledWith(
      '/tasks/42',
      expect.objectContaining({ klient_telefon: '+48 600 700 800' }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  await waitFor(() => {
    expect(document.body.textContent).toContain('Zlecenie #42');
    expect(document.body.textContent).not.toContain('Tryb naprawy');
  }, SLOW_FORM_RENDER);
}, 15000);

test('opens routed office planning focus links in task details', async () => {
  mockZleceniaApi();

  renderRoute('/zlecenia/42?focus=officePlan');

  expect(await screen.findByText('Do zaplanowania dla ekipy', {}, SLOW_FORM_RENDER)).toBeInTheDocument();
  const officePlanSection = document.querySelector('[data-detail-section="officePlan"]');
  expect(officePlanSection).toBeTruthy();

  await waitFor(() => {
    expect(scrollIntoViewMock.mock.contexts).toContain(officePlanSection);
  });
}, 15000);

test('blocks office plan when selected team vehicle is in repair', async () => {
  mockZleceniaApi({
    task: {
      ...TASK,
      ekipa_id: 3,
      ekipa_nazwa: 'Brygada Alfa',
      data_planowana: '2026-06-02T08:00:00.000Z',
      godzina_rozpoczecia: '08:00',
    },
    vehicles: [
      {
        id: 5,
        marka: 'Mercedes',
        model: 'Sprinter',
        nr_rejestracyjny: 'KR12345',
        status: 'W naprawie',
        ekipa_id: 3,
        oddzial_id: 7,
      },
    ],
    equipment: [
      {
        id: 11,
        nazwa: 'Rebak Forst',
        typ: 'Rebak',
        status: 'W naprawie',
        ekipa_id: 3,
        oddzial_id: 7,
      },
    ],
  });

  renderRoute('/zlecenia/42?focus=officePlan');

  expect(await screen.findByText('Do zaplanowania dla ekipy', {}, SLOW_FORM_RENDER)).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByText('Zasoby ekipy').length).toBeGreaterThan(0), SLOW_FORM_RENDER);
  await waitFor(() => {
    expect(document.body.textContent).toContain('Auto: Mercedes Sprinter KR12345');
    expect(document.body.textContent).toContain('Rebak Forst');
    expect(document.body.textContent).toContain('Zasoby w naprawie');
  }, SLOW_FORM_RENDER);
  const officePlanSection = document.querySelector('[data-detail-section="officePlan"]');
  expect(officePlanSection).toBeTruthy();
  expect(within(officePlanSection).getByRole('button', { name: 'Otworz naprawy' })).toBeInTheDocument();
  expect(within(officePlanSection).getByRole('button', { name: 'Otworz ekipy' })).toBeInTheDocument();
  fireEvent.click(within(officePlanSection).getByRole('button', { name: 'Otworz naprawy' }));
  expect(await screen.findByText(/Flota fokus:/, {}, SLOW_FORM_RENDER)).toBeInTheDocument();
  expect(screen.getByTestId('location-probe')).toHaveTextContent('tab=naprawy');
  expect(screen.getByTestId('location-probe')).toHaveTextContent('team=3');
  expect(screen.getByTestId('location-probe')).toHaveTextContent('kind=Auto');
  expect(screen.getByTestId('location-probe')).toHaveTextContent('resource=5');
  expect(screen.getByTestId('location-probe')).toHaveTextContent('returnTo=%2Fzlecenia%2F42%3Ffocus%3DofficePlan');
}, 15000);

test('closes matched team resource repair directly from office plan', async () => {
  mockZleceniaApi({
    task: {
      ...TASK,
      ekipa_id: 3,
      ekipa_nazwa: 'Brygada Alfa',
      data_planowana: '2026-06-02T08:00:00.000Z',
      godzina_rozpoczecia: '08:00',
    },
    vehicles: [
      {
        id: 5,
        marka: 'Mercedes',
        model: 'Sprinter',
        nr_rejestracyjny: 'KR12345',
        status: 'W naprawie',
        ekipa_id: 3,
        oddzial_id: 7,
      },
    ],
    repairs: [
      {
        id: 90,
        typ_zasobu: 'Pojazd',
        zasob_id: 5,
        status: 'W toku',
        opis_usterki: 'Alternator',
      },
    ],
  });
  api.put.mockResolvedValue({ data: { id: 90, status: 'Zakonczona' } });

  renderRoute('/zlecenia/42?focus=officePlan');

  expect(await screen.findByText('Do zaplanowania dla ekipy', {}, SLOW_FORM_RENDER)).toBeInTheDocument();
  const officePlanSection = document.querySelector('[data-detail-section="officePlan"]');
  expect(officePlanSection).toBeTruthy();
  const closeRepairBtn = await within(officePlanSection).findByRole('button', { name: 'Zakoncz naprawe' }, SLOW_FORM_RENDER);
  fireEvent.click(closeRepairBtn);

  await waitFor(() => {
    expect(api.put).toHaveBeenCalledWith(
      '/flota/naprawy/90',
      expect.objectContaining({
        id: 90,
        status: 'Zakonczona',
        opis_naprawy: 'Zakonczono naprawe z planu biura',
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
}, 15000);

test('shows backend team resource block details while saving office plan', async () => {
  mockZleceniaApi({
    task: {
      ...TASK,
      ekipa_id: 3,
      ekipa_nazwa: 'Brygada Alfa',
      data_planowana: '2026-06-02T08:00:00.000Z',
      godzina_rozpoczecia: '08:00',
    },
  });
  api.put.mockRejectedValue({
    response: {
      data: {
        code: 'TEAM_RESOURCE_UNAVAILABLE',
        items: [
          { kind: 'Sprzet', label: 'Rebak Forst', status: 'W naprawie' },
          { kind: 'Auto', label: 'Mercedes Sprinter KR1ARB', status: 'Serwis' },
        ],
      },
    },
  });

  renderRoute('/zlecenia/42?focus=officePlan');

  expect(await screen.findByText('Do zaplanowania dla ekipy', {}, SLOW_FORM_RENDER)).toBeInTheDocument();
  const officePlanSection = document.querySelector('[data-detail-section="officePlan"]');
  expect(officePlanSection).toBeTruthy();
  fireEvent.change(officePlanSection.querySelector('input[type="date"]'), {
    target: { value: '2026-06-02' },
  });
  fireEvent.change(officePlanSection.querySelector('input[type="time"]'), {
    target: { value: '08:00' },
  });
  fireEvent.change(officePlanSection.querySelector('input[type="number"]'), {
    target: { value: '3' },
  });
  fireEvent.change(officePlanSection.querySelector('select:not([multiple])'), {
    target: { value: '3' },
  });
  const saveButton = await within(officePlanSection).findByRole('button', { name: 'Zapisz i ustaw Zaplanowane' }, SLOW_FORM_RENDER);
  await waitFor(() => expect(saveButton).not.toBeDisabled(), SLOW_FORM_RENDER);
  fireEvent.click(saveButton);

  await waitFor(() => {
    expect(document.body.textContent).toContain('Ekipa ma zasoby w naprawie: Sprzet: Rebak Forst (W naprawie), Auto: Mercedes Sprinter KR1ARB (Serwis).');
  }, SLOW_FORM_RENDER);
}, 15000);

test('shows routed task GPS history and refreshes the selected day', async () => {
  mockZleceniaApi({
    task: {
      ...TASK,
      status: 'Zaplanowane',
      ekipa_id: 3,
      ekipa_nazwa: 'Brygada Alfa',
      data_planowana: '2026-05-26T08:00:00.000Z',
    },
  });

  renderRoute('/zlecenia/42');

  expect(await screen.findByText('Historia GPS dnia', {}, SLOW_FORM_RENDER)).toBeInTheDocument();
  expect(await screen.findByText('2 pkt')).toBeInTheDocument();
  expect(screen.getByText('Max predkosc')).toBeInTheDocument();
  expect(screen.getByText('38 km/h')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Trasa GPS/ })).toHaveAttribute(
    'href',
    expect.stringContaining('https://www.google.com/maps/dir/')
  );

  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining('/ekipy/gps-history?date=2026-05-26'),
      expect.objectContaining({ dedupe: false })
    );
  });

  fireEvent.change(screen.getByLabelText('Data historii GPS'), {
    target: { value: '2026-05-27' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Odswiez' }));

  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining('/ekipy/gps-history?date=2026-05-27'),
      expect.objectContaining({ dedupe: false })
    );
  });
}, 15000);

test('opens crew schedule deep link from task planning handoff', async () => {
  mockZleceniaApi({
    task: {
      ...TASK,
      status: 'Do_Zatwierdzenia',
      ekipa_id: 3,
      ekipa_nazwa: 'Brygada Alfa',
      data_planowana: '2026-05-26T08:00:00.000Z',
    },
  });

  renderRoute('/zlecenia/42');
  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith('/tasks/42', expect.any(Object));
  });

  fireEvent.click(await screen.findByRole('button', { name: /Otwórz harmonogram ekip/i }, SLOW_FORM_RENDER));

  expect(await screen.findByTestId('location-probe')).toHaveTextContent('Harmonogram fokus');
  expect(screen.getByTestId('location-probe')).toHaveTextContent('task=42');
  expect(screen.getByTestId('location-probe')).toHaveTextContent('team=3');
  expect(screen.getByTestId('location-probe')).toHaveTextContent('date=2026-05-26');
  expect(screen.getByTestId('location-probe')).toHaveTextContent('oddzial=7');
}, 15000);

test('keeps task data visible when a secondary startup request fails', async () => {
  const equipment = [];
  const vehicles = [];
  api.get.mockImplementation((url) => {
    if (url === '/tasks/wszystkie') return Promise.resolve({ data: [TASK] });
    if (url === '/tasks/42') return Promise.resolve({ data: TASK });
    if (url === '/ekipy') return Promise.resolve({ data: [{ id: 3, nazwa: 'Brygada Alfa', oddzial_id: 7 }] });
    if (url === '/uzytkownicy') {
      return Promise.reject(Object.assign(new Error('boom'), {
        response: { status: 500 },
        config: { method: 'get', url: '/uzytkownicy' },
      }));
    }
    if (url === '/oddzialy') return Promise.resolve({ data: [{ id: 7, nazwa: 'Wroclaw' }] });
    if (url === '/flota/sprzet') return Promise.resolve({ data: equipment });
    if (url === '/flota/pojazdy') return Promise.resolve({ data: vehicles });
    if (url === '/tasks/client-contacts') return Promise.resolve({ data: null });
    if (url === '/tasks/closure-events') return Promise.resolve({ data: null });
    if (String(url).startsWith('/tasks/42/')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });

  renderRoute('/zlecenia/42');

  expect(await screen.findByText('Zlecenie #42', {}, SLOW_FORM_RENDER)).toBeInTheDocument();
  expect(screen.getAllByText('Jan Kowalski').length).toBeGreaterThan(0);
  expect(document.body.textContent).not.toContain('Błąd serwera API');
}, 15000);
