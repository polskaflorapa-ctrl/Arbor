import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { vi } from 'vitest';
import Harmonogram from './Harmonogram';
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
  imie: 'Anna',
  nazwisko: 'Planer',
  oddzial_id: 7,
});

const TASK = {
  id: 42,
  status: 'Zaplanowane',
  klient_nazwa: 'Klient harmonogramu',
  adres: 'Lesna 12',
  miasto: 'Wroclaw',
  oddzial_id: 7,
  ekipa_id: 3,
  ekipa_nazwa: 'Brygada Alfa',
  data_planowana: '2026-05-26T08:00:00.000Z',
  godzina_rozpoczecia: '08:00',
  czas_planowany_godziny: 3,
  wartosc_planowana: 2500,
  opis_pracy: 'Przycinka koron nad podjazdem',
  photo_total: 2,
};

function mockHarmonogramApi() {
  api.get.mockImplementation((url) => {
    if (url === '/tasks/wszystkie') return Promise.resolve({ data: [TASK] });
    if (url === '/oddzialy') return Promise.resolve({ data: [{ id: 7, nazwa: 'Wroclaw' }] });
    if (url === '/ekipy') return Promise.resolve({ data: [{ id: 3, nazwa: 'Brygada Alfa', oddzial_id: 7, kolor: '#168A4A' }] });
    if (String(url).startsWith('/flota/rezerwacje')) return Promise.resolve({ data: [] });
    if (url === '/ekipy/live-locations') return Promise.resolve({ data: { items: [] } });
    if (url === '/tasks/42/zdjecia') {
      return Promise.resolve({ data: [{ typ: 'wycena', opis: 'Korona od ulicy', url: 'https://img.test/a.jpg' }] });
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
        <Route path="/harmonogram" element={<Harmonogram />} />
        <Route path="/" element={<div>Login</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function HarmonogramRouteHarness() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/harmonogram')}>
        Reset route
      </button>
      <Harmonogram />
    </>
  );
}

function renderRouteHarness(path) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/harmonogram" element={<HarmonogramRouteHarness />} />
        <Route path="/" element={<div>Login</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'test-jwt');
  localStorage.setItem('user', USER_JSON);
  api.get.mockReset();
  api.patch.mockReset();
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('opens harmonogram deep link on the requested task, team and day', async () => {
  mockHarmonogramApi();

  renderRoute('/harmonogram?date=2026-05-26&team=3&task=42&oddzial=7&view=dzien');

  expect((await screen.findAllByText('Klient harmonogramu', {}, { timeout: 10000 })).length).toBeGreaterThan(0);
  expect(screen.getByText(/Dispatch dnia:/)).toBeInTheDocument();
  expect(screen.getAllByText(/Brygada Alfa/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Lesna 12/).length).toBeGreaterThan(0);

  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith('/tasks/wszystkie', expect.objectContaining({ headers: expect.any(Object) }));
  });
});

test('clears deep-link quick panel state after navigating to bare harmonogram route', async () => {
  mockHarmonogramApi();

  renderRouteHarness('/harmonogram?date=2026-05-26&team=3&task=42&oddzial=7&view=dzien');

  expect(await screen.findByTestId('harmonogram-quick-panel')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Reset route' }));

  await waitFor(() => {
    expect(screen.queryByTestId('harmonogram-quick-panel')).not.toBeInTheDocument();
  });
}, 15000);

test('copies a crew-ready brief from the focused schedule task', async () => {
  mockHarmonogramApi();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });

  renderRoute('/harmonogram?date=2026-05-26&team=3&task=42&oddzial=7&view=dzien');

  expect(await screen.findByText(/1\/6 typow pakietu/i, {}, { timeout: 10000 })).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: /Kopiuj odprawe zlecenia/i }, { timeout: 10000 }));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  const copied = writeText.mock.calls[0][0];
  expect(copied).toContain('ARBOR-OS | ODPRAWA EKIPY | Zlecenie #42');
  expect(copied).toContain('Klient harmonogramu');
  expect(copied).toContain('Lesna 12');
  expect(copied).toContain('Przycinka koron nad podjazdem');
  expect(copied).toContain('Korona od ulicy');
});

test('falls back to textarea copy when browser clipboard is blocked', async () => {
  mockHarmonogramApi();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
    configurable: true,
  });
  const execCommand = vi.fn().mockReturnValue(true);
  Object.defineProperty(document, 'execCommand', {
    value: execCommand,
    configurable: true,
  });

  renderRoute('/harmonogram?date=2026-05-26&team=3&task=42&oddzial=7&view=dzien');

  expect(await screen.findByText(/1\/6 typow pakietu/i, {}, { timeout: 10000 })).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: /Kopiuj odprawe zlecenia/i }, { timeout: 10000 }));

  await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
  expect(await screen.findByText(/Odprawa zlecenia #42 skopiowana/i)).toBeInTheDocument();
});
