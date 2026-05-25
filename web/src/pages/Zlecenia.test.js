import '../i18n';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

const TASK = {
  id: 42,
  status: 'Do_Zatwierdzenia',
  klient_nazwa: 'Jan Kowalski',
  klient_telefon: '',
  klient_email: '',
  adres: 'Lesna 12',
  miasto: 'Wroclaw',
  typ_uslugi: 'Pielęgnacja',
  oddzial_id: 7,
  data_planowana: '',
  godzina_rozpoczecia: '',
  wartosc_planowana: 2500,
  czas_planowany_godziny: 3,
  opis_pracy: 'Przycinka koron nad podjazdem',
  ekipa_id: '',
};

function mockZleceniaApi() {
  api.get.mockImplementation((url) => {
    if (url === '/tasks/wszystkie') return Promise.resolve({ data: [TASK] });
    if (url === '/tasks/42') return Promise.resolve({ data: TASK });
    if (url === '/ekipy') return Promise.resolve({ data: [{ id: 3, nazwa: 'Brygada Alfa', oddzial_id: 7 }] });
    if (url === '/uzytkownicy') return Promise.resolve({ data: [] });
    if (url === '/oddzialy') return Promise.resolve({ data: [{ id: 7, nazwa: 'Wroclaw' }] });
    if (url === '/flota/sprzet') return Promise.resolve({ data: [] });
    if (url === '/tasks/client-contacts') return Promise.resolve({ data: null });
    if (url === '/tasks/closure-events') return Promise.resolve({ data: null });
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
        <Route path="/" element={<div>Login</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.setItem('token', 'test-jwt');
  localStorage.setItem('user', USER_JSON);
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

  expect(await screen.findByText('Tryb naprawy')).toBeInTheDocument();
  expect(screen.getByText('Brak telefonu')).toBeInTheDocument();
  expect(screen.getByText('Dodaj numer telefonu klienta.')).toBeInTheDocument();

  const phoneInput = screen.getByPlaceholderText('+48 000 000 000');
  expect(phoneInput).toHaveValue('');
  await waitFor(() => expect(document.activeElement).toBe(phoneInput));
});
