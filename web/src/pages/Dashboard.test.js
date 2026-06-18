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

test('filters legacy test fixture tasks from active Polska Flora dashboard', async () => {
  const notTodayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
            data_planowana: `${notTodayIso}T08:00:00.000Z`,
            wartosc_planowana: 999,
          },
          {
            id: 66,
            numer: 'ZLE-0066',
            klient_nazwa: 'SMOKE klient operacyjny 1779434036264',
            opis: 'Automatyczny rekord smoke testu',
            status: 'Nowe',
            data_planowana: `${notTodayIso}T08:00:00.000Z`,
            wartosc_planowana: 1500,
          },
          {
            id: 1234,
            numer: 'ARB-1234',
            klient_nazwa: 'Realny Klient',
            opis: 'Pielegnacja drzew',
            status: 'Zaplanowane',
            data_planowana: `${notTodayIso}T09:00:00.000Z`,
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

  expect(await screen.findByText('Witaj, Anna.')).toBeInTheDocument();
  expect(await screen.findAllByText('Realny Klient')).not.toHaveLength(0);
  await waitFor(() => expect(screen.queryByText('Test Klient Demo')).not.toBeInTheDocument());
  expect(screen.queryByText(/SMOKE klient operacyjny/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/nowych zleceń/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/prac w terenie/i)).not.toBeInTheDocument();
  expect(screen.queryByTestId('dashboard-system-alert-count')).not.toBeInTheDocument();
  expect(screen.getByText('Live ops')).toBeInTheDocument();
  expect(screen.getByText('Aktywne zlecenia')).toBeInTheDocument();
  expect(screen.getByText('Brak zaplanowanych prac na dziś.')).toBeInTheDocument();
  expect(screen.getAllByText('1/1').length).toBeGreaterThan(0);
});

test('renders active cockpit for non-diacritic estimator role variant', async () => {
  localStorage.setItem('user', JSON.stringify({
    id: 8,
    imie: 'Ewa',
    rola: 'Wyceniajacy',
    oddzial_nazwa: 'Krakow',
  }));
  api.get.mockImplementation(async (path) => {
    if (path === '/tasks/wszystkie') return { data: [] };
    if (path === '/ekipy/ranking') return { data: null };
    if (path === '/payroll/month-close-status') {
      return { data: { export_allowed: true, pending_count: 0 } };
    }
    return { data: null };
  });

  renderDashboard();

  expect(await screen.findByText('Witaj, Ewa.')).toBeInTheDocument();
  expect(screen.getByText('Centrum operacyjne')).toBeInTheDocument();
  expect(screen.getByText('Live ops')).toBeInTheDocument();
  expect(screen.getByText('Przyjmij telefon')).toBeInTheDocument();
  expect(screen.getByText('CRM dzisiaj')).toBeInTheDocument();
  expect(screen.getByText('Telefon / Ania')).toBeInTheDocument();
  expect(screen.getByText('Oględziny')).toBeInTheDocument();
  expect(screen.getByText('Wycena')).toBeInTheDocument();
  expect(screen.getByText('Ekipa')).toBeInTheDocument();
});

test('renders today command list with operational blockers and next actions', async () => {
  const yesterdayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayIso = new Date().toISOString().slice(0, 10);
  api.get.mockImplementation(async (path) => {
    if (path === '/tasks/wszystkie') {
      return {
        data: [
          {
            id: 2001,
            numer: 'PF-2001',
            klient_nazwa: 'Ogrody Lipowa 8',
            klient_telefon: '',
            opis: 'Nowe zgłoszenie z telefonu',
            status: 'Nowe',
            data_planowana: `${todayIso}T09:00:00.000Z`,
            wartosc_planowana: 1200,
          },
          {
            id: 2002,
            numer: 'PF-2002',
            klient_nazwa: 'Dachy Podgórze',
            klient_telefon: '500100200',
            opis: 'Mycie dachu po terminie',
            status: 'Zaplanowane',
            data_planowana: `${yesterdayIso}T10:00:00.000Z`,
            wartosc_planowana: 2500,
          },
          {
            id: 2003,
            numer: 'PF-2003',
            klient_nazwa: 'Kostka Wielicka',
            klient_telefon: '500300400',
            opis: 'Czyszczenie kostki do wyceny',
            status: 'Do wyceny',
            data_planowana: `${todayIso}T12:00:00.000Z`,
            wartosc_planowana: 0,
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

  expect(await screen.findByText('Dzisiaj do ogarnięcia')).toBeInTheDocument();
  expect(screen.getByText('Telefon / CRM')).toBeInTheDocument();
  expect(screen.getByText('Brak telefonu u klienta')).toBeInTheDocument();
  expect(screen.getByText('Termin / SLA')).toBeInTheDocument();
  expect(screen.getAllByText('Po terminie').length).toBeGreaterThan(0);
  expect(screen.getByText('Ekipy')).toBeInTheDocument();
  expect(screen.getByText('Zlecenia bez ekipy')).toBeInTheDocument();
  expect(screen.getByText('Wycena / oferta')).toBeInTheDocument();
  expect(screen.getByText('Do wyceny lub wysłania oferty')).toBeInTheDocument();
});

test('renders task readiness checklist summary for crew handoff', async () => {
  const todayIso = new Date().toISOString().slice(0, 10);
  api.get.mockImplementation(async (path) => {
    if (path === '/tasks/wszystkie') {
      return {
        data: [
          {
            id: 3001,
            numer: 'PF-3001',
            klient_nazwa: 'Gotowe Drzewa',
            klient_telefon: '+48500100200',
            adres: 'Lipowa 8',
            opis: 'Wycinka',
            status: 'Zaplanowane',
            data_planowana: `${todayIso}T08:00:00.000Z`,
            wartosc_planowana: 1800,
            ekipa_id: 2,
            ekipa_nazwa: 'Brygada Alfa',
          },
          {
            id: 3002,
            numer: 'PF-3002',
            klient_nazwa: 'Niegotowa Kostka',
            klient_telefon: '',
            adres: '',
            opis: '',
            status: 'Zaplanowane',
            data_planowana: '',
            wartosc_planowana: 0,
            ekipa_id: null,
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

  expect(await screen.findByText('Gotowość zleceń')).toBeInTheDocument();
  expect(screen.getByText('1/2')).toBeInTheDocument();
  expect(screen.getByText('Pakiet dla ekipy niegotowy')).toBeInTheDocument();
  expect(screen.getAllByText('Niegotowa Kostka').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Brak telefonu').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Brak adresu').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Brak wyceny').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Brak ekipy').length).toBeGreaterThan(0);
});

test('renders money blockers for quotes, acceptance, and settlement', async () => {
  const todayIso = new Date().toISOString().slice(0, 10);
  api.get.mockImplementation(async (path) => {
    if (path === '/tasks/wszystkie') {
      return {
        data: [
          {
            id: 4001,
            klient_nazwa: 'Oferta bez ceny',
            klient_telefon: '+48500100200',
            adres: 'Lipowa 8',
            opis: 'Pielęgnacja drzew',
            status: 'Do wyceny',
            data_planowana: `${todayIso}T09:00:00.000Z`,
            wartosc_planowana: 0,
            ekipa_id: 1,
          },
          {
            id: 4002,
            klient_nazwa: 'Oferta do decyzji',
            klient_telefon: '+48500100300',
            adres: 'Wielicka 10',
            opis: 'Mycie dachu',
            status: 'Oferta wyslana',
            oferta_status: 'oczekuje_na_akceptacje',
            data_planowana: `${todayIso}T10:00:00.000Z`,
            wartosc_planowana: 3200,
            ekipa_id: 2,
          },
          {
            id: 4003,
            klient_nazwa: 'Zrobione bez rozliczenia',
            klient_telefon: '+48500100400',
            adres: 'Krakowska 1',
            opis: 'Czyszczenie kostki',
            status: 'Zakonczone',
            data_planowana: `${todayIso}T11:00:00.000Z`,
            wartosc_planowana: 1800,
            wartosc_rzeczywista: 0,
            rozliczone: false,
            ekipa_id: 3,
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

  expect(await screen.findByText('Co blokuje pieniądze')).toBeInTheDocument();
  expect(screen.getAllByText('Brak ceny').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Oferty do akceptacji').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Wykonane bez rozliczenia').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Oferta bez ceny').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Oferta do decyzji').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Zrobione bez rozliczenia').length).toBeGreaterThan(0);
});
