import '../i18n';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import WycenaKalendarz from './WycenaKalendarz';
import api from '../api';

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

vi.mock('../components/Sidebar', () => ({
  __esModule: true,
  default: () => <aside data-testid="sidebar" />,
}));

vi.mock('../components/StatusMessage', () => ({
  __esModule: true,
  default: ({ message }) => (message ? <div>{message}</div> : null),
}));

vi.mock('../utils/calendarBlocks', () => ({
  loadCalendarBlocks: () => [],
  isYmdBlocked: () => false,
}));

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={['/wycena-kalendarz?view=combined']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <WycenaKalendarz />
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'test-token');
  localStorage.setItem(
    'user',
    JSON.stringify({
      id: 7,
      imie: 'Anna',
      nazwisko: 'Kierownik',
      rola: 'Kierownik',
      oddzial_id: 1,
    })
  );
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();

  const today = new Date();
  const ymd = today.toISOString().slice(0, 10);

  api.get.mockImplementation(async (path) => {
    if (path === '/wyceny') {
      return {
        data: [
          {
            id: 31,
            klient: 'Realny Klient',
            klient_nazwa: 'Realny Klient',
            status_akceptacji: 'oczekuje',
            data_wykonania: `${ymd}T08:00:00.000Z`,
            proponowana_ekipa_id: 3,
            lat: null,
            lon: null,
          },
        ],
      };
    }
    if (path === '/ekipy') {
      return { data: [{ id: 3, nazwa: 'Brygada Alfa' }] };
    }
    if (path === '/ogledziny') {
      return {
        data: [
          {
            id: 41,
            klient_nazwa: 'Klient Ogl',
            data_planowana: `${ymd}T10:00:00.000Z`,
          },
        ],
      };
    }
    if (path === '/ekipy/live-locations') {
      return {
        data: {
          items: [
            {
              ekipa_id: 3,
              ekipa_nazwa: 'Brygada Alfa',
              lat: 50.0614,
              lng: 19.9366,
              recorded_at: `${ymd}T07:30:00.000Z`,
            },
          ],
        },
      };
    }
    if (path === '/quotations/panel/sla-przeterminowane') {
      return {
        data: [
          {
            quotation_id: 31,
            approval_id: 501,
            klient_nazwa: 'Realny Klient',
            wymagany_typ: 'manager',
            due_at: `${ymd}T09:30:00.000Z`,
            sla_reminder_sent_at: null,
          },
        ],
      };
    }
    return { data: null };
  });
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('renders the new hero stats, SLA panel, and KPI cards', async () => {
  renderPage();

  expect(await screen.findByText('Kalendarz Wycen')).toBeInTheDocument();
  expect(screen.getByText('Planowanie wycen')).toBeInTheDocument();
  expect(screen.getByText('Wybrany dzień')).toBeInTheDocument();
  expect(screen.getByText('SLA po terminie')).toBeInTheDocument();
  expect(screen.getByText('Tryb')).toBeInTheDocument();
  expect(screen.getByText('Miesiąc: wyceny')).toBeInTheDocument();
  expect(screen.getByText('Ryzyka danych')).toBeInTheDocument();
  expect(screen.getByText('1 ekip live')).toBeInTheDocument();
  expect(screen.getByText(/SLA .*zatwierdzenia po terminie/i)).toBeInTheDocument();
  expect(screen.getAllByText(/Realny Klient/i).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: /\+ Nowa wycena/i })).toBeInTheDocument();
});
