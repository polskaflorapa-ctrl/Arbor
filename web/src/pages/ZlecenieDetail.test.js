import '../i18n';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import ZlecenieDetail from './ZlecenieDetail';
import api from '../api';

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../components/Sidebar', () => ({
  __esModule: true,
  default: () => <aside data-testid="sidebar" />,
}));

vi.mock('../components/TaskCommandCenter', () => ({
  __esModule: true,
  default: () => <section data-testid="task-command-center" />,
}));

const task = {
  id: 42,
  numer: 'ZL/42',
  klient_nazwa: 'Klient Testowy',
  klient_telefon: '+48500111222',
  adres: 'Lesna 12',
  miasto: 'Wroclaw',
  status: 'Zaplanowane',
  priorytet: 'Normalny',
  typ_uslugi: 'Pielegnacja',
  data_planowana: '2026-05-26T08:00:00.000Z',
  czas_planowany_godziny: 2,
  wartosc_planowana: 1500,
  koszt_robocizny: 400,
  ekipa_id: 3,
  ekipa_nazwa: 'Brygada Alfa',
  oddzial_id: 1,
  finish_requirements: {},
  equipment_reservations: [],
};

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

function mockApi({ taskOverride = {}, workLogs = [] } = {}) {
  const taskRow = { ...task, ...taskOverride };
  api.get.mockImplementation(async (path) => {
    if (path === '/tasks/42') return { data: taskRow };
    if (path === '/tasks/42/logi') return { data: workLogs };
    if (path === '/tasks/42/problemy') return { data: [] };
    if (path === '/tasks/42/zdjecia') return { data: [] };
    if (path === '/tasks/42/wideo') return { data: [] };
    if (path === '/dniowki/zlecenie/42') return { data: { dniowki: [] } };
    if (path === '/tasks/42/workflow') {
      return { data: { checklist: [], reminders: [], events: [], sla: { checklist_done: 0, checklist_total: 0, reminders_overdue: 0 } } };
    }
    if (path === '/tasks/42/dokumenty') return { data: [] };
    if (path === '/tasks/42/integrations') {
      return { data: { settings: { sms: true, email: true, push: true, auto_on_status: true, auto_on_reminder: true }, logs: [] } };
    }
    if (path === '/ekipy/live-locations') {
      return {
        data: {
          items: [{
            provider: 'mobile',
            ekipa_id: 3,
            user_id: 9,
            user_name: 'Jan Brygadzista',
            lat: 51.12,
            lng: 17.06,
            accuracy_m: 7,
            recorded_at: '2026-05-26T08:30:00',
          }],
        },
      };
    }
    if (String(path).startsWith('/ekipy/gps-history?')) {
      const params = new URLSearchParams(String(path).split('?')[1]);
      const date = params.get('date') || '2026-05-26';
      return { data: { date, items: gpsRows(date), count: 2 } };
    }
    return { data: null };
  });
}

function renderDetail() {
  return render(
    <MemoryRouter
      initialEntries={['/zlecenia/42']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/" element={<div>Login</div>} />
        <Route path="/zlecenia/:id" element={<ZlecenieDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({
    id: 7,
    imie: 'Anna',
    rola: 'Kierownik',
    oddzial_id: 1,
  }));
  api.get.mockReset();
  api.put.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.delete.mockReset();
  mockApi();
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('loads task GPS history and refreshes it for a selected date', async () => {
  await act(async () => {
    renderDetail();
  });

  expect(await screen.findByText('Historia trasy dnia')).toBeInTheDocument();
  expect(await screen.findByText('2 pkt')).toBeInTheDocument();
  expect(screen.getByText('Max predkosc')).toBeInTheDocument();
  expect(screen.getByText('38 km/h')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Trasa GPS' })).toHaveAttribute(
    'href',
    expect.stringContaining('https://www.google.com/maps/dir/')
  );

  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining('/ekipy/gps-history?date=2026-05-26'),
      expect.objectContaining({ dedupe: false })
    );
  });

  await act(async () => {
    await userEvent.clear(screen.getByLabelText('Data historii GPS'));
    await userEvent.type(screen.getByLabelText('Data historii GPS'), '2026-05-27');
    await userEvent.click(screen.getByRole('button', { name: 'Odswiez' }));
  });

  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining('/ekipy/gps-history?date=2026-05-27'),
      expect.objectContaining({ dedupe: false })
    );
  });
});

test('submits finish with material and operational costs', async () => {
  localStorage.setItem('user', JSON.stringify({
    id: 9,
    imie: 'Jan',
    rola: 'Brygadzista',
    oddzial_id: 1,
  }));
  mockApi({
    taskOverride: { status: 'W_Realizacji', finish_requirements: { require_material_usage: false } },
    workLogs: [{ id: 701, task_id: 42, start_time: '2026-05-26T08:00:00.000Z', end_time: null }],
  });
  api.post.mockResolvedValueOnce({ data: { message: 'ok' } });

  await act(async () => {
    renderDetail();
  });

  const openFinishButton = await screen.findByRole('button', { name: /Zako.*zlecenie/i });
  await act(async () => {
    await userEvent.click(openFinishButton);
  });

  await act(async () => {
    await userEvent.clear(screen.getByPlaceholderText(/Nazwa materia/i));
    await userEvent.type(screen.getByPlaceholderText(/Nazwa materia/i), 'Paliwo mieszanka');
    await userEvent.type(screen.getByPlaceholderText(/Ilo/i), '5');
    await userEvent.type(screen.getByPlaceholderText(/Koszt materia/i), '80');
    await userEvent.type(screen.getByPlaceholderText('Sprzęt PLN'), '100');
    await userEvent.type(screen.getByPlaceholderText('Paliwo PLN'), '50');
    await userEvent.type(screen.getByPlaceholderText('Utylizacja PLN'), '40');
    await userEvent.type(screen.getByPlaceholderText('Inne PLN'), '10');
    await userEvent.click(screen.getByRole('button', { name: /^Zako.*zlecenie$/i }));
  });

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/tasks/42/finish',
      expect.objectContaining({
        zuzyte_materialy: [expect.objectContaining({ nazwa: 'Paliwo mieszanka', ilosc: 5, koszt_laczny: 80 })],
        koszty_operacyjne: expect.arrayContaining([
          expect.objectContaining({ category: 'sprzet', amount: 100, source: 'web_finish' }),
          expect.objectContaining({ category: 'paliwo', amount: 50, source: 'web_finish' }),
          expect.objectContaining({ category: 'utylizacja', amount: 40, source: 'web_finish' }),
          expect.objectContaining({ category: 'inne', amount: 10, source: 'web_finish' }),
        ]),
      }),
      expect.any(Object)
    );
  });
});
