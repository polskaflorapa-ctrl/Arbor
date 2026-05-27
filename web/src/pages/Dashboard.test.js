import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import Dashboard from './Dashboard';
import api from '../api';

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
  },
}));

vi.mock('../components/Sidebar', () => ({
  __esModule: true,
  default: () => <aside data-testid="sidebar" />,
}));

vi.mock('../components/OpsRadar', () => ({
  __esModule: true,
  default: ({ tasks = [] }) => <div data-testid="ops-radar">{tasks.length}</div>,
}));

vi.mock('../components/TelemetryStatus', () => ({
  __esModule: true,
  default: ({ label }) => <span>{label}</span>,
}));

function renderDashboard() {
  return render(
    <MemoryRouter
      initialEntries={['/dashboard']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/" element={<div>Login</div>} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  api.get.mockReset();
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({
    id: 7,
    imie: 'Anna',
    rola: 'Kierownik',
    oddzial_nazwa: 'Krakow',
  }));
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('filters legacy test fixture tasks from dashboard metrics and lists', async () => {
  const currentMonth = new Date().toISOString().slice(0, 7);
  api.get.mockImplementation(async (path) => {
    if (path === '/tasks/wszystkie') {
      return {
        data: [
          {
            id: 12,
            numer: 'TEST-12',
            klient_nazwa: 'Test Klient Demo',
            opis: 'Testowe zlecenie migracyjne',
            status: 'Nowe',
            data_planowana: `${currentMonth}-10T08:00:00.000Z`,
            wartosc_planowana: 999,
          },
          {
            id: 66,
            numer: 'ZLE-0066',
            klient_nazwa: 'SMOKE klient operacyjny 1779434036264',
            opis: 'Automatyczny rekord smoke testu',
            status: 'Nowe',
            data_planowana: `${currentMonth}-09T08:00:00.000Z`,
            wartosc_planowana: 1500,
          },
          {
            id: 1234,
            numer: 'ARB-1234',
            klient_nazwa: 'Realny Klient',
            opis: 'Pielegnacja drzew',
            status: 'Zaplanowane',
            data_planowana: `${currentMonth}-11T09:00:00.000Z`,
            ekipa_id: 5,
            ekipa_nazwa: 'Brygada Alfa',
            wartosc_planowana: 1500,
          },
        ],
      };
    }
    if (path === '/ekipy/ranking') return { data: null };
    if (path === '/payroll/month-close-status') {
      return { data: { export_allowed: true, pending_count: 0 } };
    }
    return { data: null };
  });

  renderDashboard();

  expect(await screen.findAllByText('Realny Klient')).not.toHaveLength(0);
  await waitFor(() => expect(screen.queryByText('Test Klient Demo')).not.toBeInTheDocument());
  expect(screen.queryByText(/SMOKE klient operacyjny/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/nowych zleceń/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/prac w terenie/i)).not.toBeInTheDocument();
  expect(screen.getByTestId('ops-radar')).toHaveTextContent('1');
});
