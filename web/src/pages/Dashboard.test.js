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

vi.mock('../components/CommandSidebar', () => ({
  __esModule: true,
  default: () => <aside data-testid="command-sidebar" />,
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

// Pulpit odwzorowuje makiete Polska Flora (Centrum operacyjne): topbar z powitaniem,
// ciemne hero, siatka 5 kafli KPI oraz karty "Zlecenia do decyzji" / "Ekipy w terenie".
// Testy sprawdzaja ten kontrakt widoku + filtrowanie danych demo (logika kontenera).

const notTodayIso = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

test('renders Polska Flora cockpit chrome and filters legacy demo fixtures', async () => {
  const day = notTodayIso();
  api.get.mockImplementation(async (path) => {
    if (path === '/tasks/wszystkie') {
      return {
        data: [
          { id: 12, numer: 'TEST-12', klient_nazwa: 'Test Klient Demo', opis: 'Testowe zlecenie migracyjne', status: 'Nowe', data_planowana: `${day}T08:00:00.000Z`, wartosc_planowana: 999 },
          { id: 66, numer: 'ZLE-0066', klient_nazwa: 'SMOKE klient operacyjny 1779434036264', opis: 'Automatyczny rekord smoke testu', status: 'Nowe', data_planowana: `${day}T08:00:00.000Z`, wartosc_planowana: 1500 },
          { id: 1234, numer: 'ARB-1234', klient_nazwa: 'Realny Klient', typ_uslugi: 'Pielegnacja drzew', status: 'Zaplanowane', data_planowana: `${day}T09:00:00.000Z`, ekipa_id: 5, ekipa_nazwa: 'Brygada Alfa', wartosc_planowana: 1500 },
        ],
      };
    }
    if (path === '/ekipy/ranking') return { data: null };
    if (path === '/payroll/month-close-status') return { data: { export_allowed: true, pending_count: 0 } };
    return { data: null };
  });

  renderDashboard();

  // Topbar + powitanie zalogowanego uzytkownika (tekst zawiera imie).
  expect(await screen.findByText(/Witaj, Anna\./)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /Centrum operacyjne/i })).toBeInTheDocument();

  // Siatka KPI makiety.
  expect(screen.getByText('Aktywne zlecenia')).toBeInTheDocument();
  expect(screen.getByText('W realizacji')).toBeInTheDocument();
  expect(screen.getByText('Śr. marża')).toBeInTheDocument();

  // Karty makiety.
  expect(screen.getByText('Zlecenia do decyzji')).toBeInTheDocument();
  expect(screen.getByText('Ekipy w terenie')).toBeInTheDocument();

  // Filtr danych demo/testowych (logika kontenera) — nie pokazujemy fikcyjnych rekordow.
  await waitFor(() => expect(screen.queryByText(/Test Klient Demo/i)).not.toBeInTheDocument());
  expect(screen.queryByText(/SMOKE klient operacyjny/i)).not.toBeInTheDocument();
});

test('greets non-diacritic estimator role variant on the cockpit', async () => {
  localStorage.setItem('user', JSON.stringify({ id: 8, imie: 'Ewa', rola: 'Wyceniajacy', oddzial_nazwa: 'Krakow' }));
  api.get.mockImplementation(async (path) => {
    if (path === '/tasks/wszystkie') return { data: [] };
    if (path === '/ekipy/ranking') return { data: null };
    if (path === '/payroll/month-close-status') return { data: { export_allowed: true, pending_count: 0 } };
    return { data: null };
  });

  renderDashboard();

  expect(await screen.findByText(/Witaj, Ewa\./)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /Centrum operacyjne/i })).toBeInTheDocument();
  expect(screen.getByText('Aktywne zlecenia')).toBeInTheDocument();
});

test('surfaces todays real field task in the decision list', async () => {
  const todayIso = new Date().toISOString().slice(0, 10);
  api.get.mockImplementation(async (path) => {
    if (path === '/tasks/wszystkie') {
      return {
        data: [
          { id: 2001, numer: 'PF-2001', klient_nazwa: 'Ogrody Lipowa 8', typ_uslugi: 'Nowe zgloszenie', adres: 'Lipowa 8', miasto: 'Warszawa', status: 'Nowe', data_planowana: `${todayIso}T09:00:00.000Z`, wartosc_planowana: 1200 },
        ],
      };
    }
    if (path === '/ekipy/ranking') return { data: null };
    if (path === '/payroll/month-close-status') return { data: { export_allowed: true, pending_count: 0 } };
    return { data: null };
  });

  renderDashboard();

  // Realne zlecenie pojawia sie jako wiersz decyzyjny (identyfikator #id w tytule).
  expect(await screen.findByText(/#2001/)).toBeInTheDocument();
  expect(screen.getByText('Zlecenia do decyzji')).toBeInTheDocument();
});
