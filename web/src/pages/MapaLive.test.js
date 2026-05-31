import '../i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import MapaLive from './MapaLive';
import api from '../api';

vi.mock('../components/Sidebar', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

const USER_JSON = JSON.stringify({
  id: 9001,
  rola: 'Dyrektor',
  imie: 'Demo',
  nazwisko: 'Dyrektor',
  oddzial_id: 1,
});

let mediaMatches = true;
const writeTextMock = vi.fn();

function mockMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: mediaMatches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function mockMapaLiveApi() {
  const day = today();
  const tasks = [
    {
      id: 102,
      status: 'Do_Zatwierdzenia',
      klient_nazwa: 'Osiedle Lesne Tarasy',
      adres: 'ul. Zielona 21',
      miasto: 'Wieliczka',
      oddzial_id: 1,
      ekipa_id: 5,
      ekipa_nazwa: 'Ekipa A',
      data_planowana: `${day}T08:00:00.000Z`,
      godzina_rozpoczecia: '08:00',
      czas_planowany_godziny: 2,
      wartosc_planowana: 3000,
      klient_telefon: '+48500111222',
      pin_lat: 50.05266,
      pin_lng: 19.93112,
    },
    {
      id: 103,
      status: 'Nowe',
      klient_nazwa: 'Anna Kowalska',
      adres: 'ul. Lesna 12',
      miasto: 'Krakow',
      oddzial_id: 1,
      wartosc_planowana: 1800,
      pin_lat: 50.06712,
      pin_lng: 19.94504,
    },
  ];
  const liveRows = [
    {
      provider: 'mobile',
      ekipa_id: 5,
      user_id: 55,
      subject_name: 'Ekipa A',
      rola: 'Brygadzista',
      oddzial_id: 1,
      lat: 50.06143,
      lng: 19.93658,
      recorded_at: new Date().toISOString(),
      battery_pct: 74,
      accuracy_m: 18,
    },
  ];

  api.get.mockImplementation((url) => {
    if (String(url).startsWith('/ekipy/live-locations')) return Promise.resolve({ data: { items: liveRows } });
    if (url === '/oddzialy') return Promise.resolve({ data: [{ id: 1, nazwa: 'Oddział Kraków' }] });
    if (url === '/tasks/wszystkie') return Promise.resolve({ data: tasks });
    if (url === '/ekipy?include_delegacje=1') return Promise.resolve({ data: [{ id: 5, nazwa: 'Ekipa A', oddzial_id: 1 }] });
    if (url === '/flota/sprzet?include_delegacje=1') return Promise.resolve({ data: [] });
    if (String(url).startsWith('/flota/rezerwacje')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
}

function renderMapaLive(initialEntry = '/mapa-live') {
  return render(
    <MemoryRouter
      initialEntries={[initialEntry]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route
          path="/mapa-live"
          element={(
            <>
              <LocationProbe />
              <MapaLive />
            </>
          )}
        />
        <Route path="/" element={<div>Login</div>} />
        <Route path="/zlecenia/:id" element={<div>Karta zlecenia</div>} />
        <Route path="/harmonogram" element={<div>Harmonogram</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'test-jwt');
  localStorage.setItem('user', USER_JSON);
  mediaMatches = true;
  mockMatchMedia();
  writeTextMock.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: writeTextMock },
    configurable: true,
  });
  api.get.mockReset();
  api.patch.mockReset();
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('keeps mobile command view and selected task in the URL', async () => {
  mockMapaLiveApi();

  renderMapaLive('/mapa-live?view=decisions&task=102');

  const decisionsTab = await screen.findByRole('tab', { name: /Decyzje/i }, { timeout: 10000 });
  expect(decisionsTab).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByText('Panel akcji')).toBeInTheDocument();
  expect(screen.getAllByText('Osiedle Lesne Tarasy').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: /Osiedle Lesne Tarasy.*Wybrane/i })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: /Dopnij plan/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Zadzwoń/i })).toHaveAttribute('href', 'tel:+48500111222');
  expect(screen.getAllByRole('link', { name: /GPS/i }).some((link) =>
    link.getAttribute('href')?.includes('google.com/maps')
  )).toBe(true);
  expect(screen.getAllByRole('button', { name: /Karta/i }).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: /Kopiuj link/i })).toBeInTheDocument();
  expect(screen.getByTestId('location-search')).toHaveTextContent('view=decisions');
  expect(screen.getByTestId('location-search')).toHaveTextContent('task=102');

  await userEvent.click(screen.getByRole('button', { name: 'Kopiuj link' }));
  await waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1));
  expect(writeTextMock.mock.calls[0][0]).toContain('#/mapa-live?');
  expect(writeTextMock.mock.calls[0][0]).toContain('view=decisions');
  expect(writeTextMock.mock.calls[0][0]).toContain('task=102');
  expect(await screen.findByText('Link skopiowany')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('tab', { name: /Plan dnia/i }));

  await waitFor(() => {
    expect(screen.getByTestId('location-search')).toHaveTextContent('view=timeline');
    expect(screen.getByTestId('location-search')).toHaveTextContent('task=102');
  });
  expect(screen.getByRole('tab', { name: /Plan dnia/i })).toHaveAttribute('aria-selected', 'true');

  await userEvent.click(screen.getByRole('tab', { name: /Decyzje/i }));
  await userEvent.click(await screen.findByRole('button', { name: /Anna Kowalska/i }));

  await waitFor(() => {
    expect(screen.getByTestId('location-search')).toHaveTextContent('view=decisions');
    expect(screen.getByTestId('location-search')).toHaveTextContent('task=103');
  });
  expect(screen.getAllByText('Anna Kowalska').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: /Anna Kowalska.*Wybrane/i })).toHaveAttribute('aria-pressed', 'true');
});

test('clears a stale selected task from the command URL', async () => {
  mockMapaLiveApi();

  renderMapaLive('/mapa-live?view=decisions&task=999999');

  expect(await screen.findByRole('tab', { name: /Decyzje/i }, { timeout: 10000 })).toHaveAttribute('aria-selected', 'true');

  await waitFor(() => {
    expect(screen.getByTestId('location-search')).toHaveTextContent('view=decisions');
    expect(screen.getByTestId('location-search')).not.toHaveTextContent('task=999999');
  });
  expect(screen.queryByText('Panel akcji')).not.toBeInTheDocument();
});

test('renders the selected command task from the URL on desktop', async () => {
  mediaMatches = false;
  mockMapaLiveApi();

  renderMapaLive('/mapa-live?view=decisions&task=102');

  expect(await screen.findByText('Wybrany temat', {}, { timeout: 10000 })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: /Decyzje/i })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Osiedle Lesne Tarasy.*Wybrane/i })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: /Kopiuj link/i })).toBeInTheDocument();
  expect(screen.getByTestId('location-search')).toHaveTextContent('view=decisions');
  expect(screen.getByTestId('location-search')).toHaveTextContent('task=102');
});
