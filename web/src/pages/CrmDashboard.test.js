import '../i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import CrmDashboard from './CrmDashboard';
import api from '../api';

vi.mock('../components/Sidebar', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../components/CommandSidebar', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../components/PageHeader', () => ({
  __esModule: true,
  default: ({ title, subtitle }) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  ),
}));

vi.mock('../components/StatusMessage', () => ({
  __esModule: true,
  default: ({ message }) => (message ? <div>{message}</div> : null),
}));

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
  },
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'crm-dashboard-token');
  api.get.mockReset();
  api.patch.mockReset();
  api.post.mockReset();
  api.get.mockImplementation((url) => {
    if (url === '/crm/overview') {
      return Promise.resolve({
        data: {
          kpis: { lead_win_rate: 33, nps_score: 25, nps_responses_30d: 4 },
          pipeline: [],
          sources: [{ source: 'whatsapp', count: 3, won: 1, lost: 1, conversion_rate: 33 }],
          analytics: {
            conversion: { open: 1, won: 1, lost: 1, technical: 0, open_rate: 33, win_rate: 33, loss_rate: 33 },
            owners: [{ owner_user_id: 21, owner_name: 'Anna CRM', open: 1, won: 1, lost: 0, conversion_rate: 50, won_value: 1200 }],
            nps: { responses: 4, avg_score: 8.3, promoters: 2, passives: 1, detractors: 1, score: 25 },
          },
          callbacks: [],
        },
      });
    }
    if (url === '/crm/messages/queue') {
      return Promise.resolve({
        data: [
          {
            id: 501,
            lead_id: 22,
            lead_title: 'Oferta ogrodu',
            channel: 'whatsapp',
            status: 'queued',
            subject: null,
            body: 'Dzien dobry, wracam z oferta.',
            retry_count: 0,
          },
        ],
      });
    }
    if (url === '/crm/messages/providers') {
      return Promise.resolve({
        data: {
          worker: { enabled: false, interval_ms: 60000 },
          channels: [
            { channel: 'sms', ready: false, provider: null, note: 'Brak konfiguracji SMS' },
            { channel: 'email', ready: true, provider: 'smtp', note: 'SMTP gotowy do wysylki' },
            { channel: 'whatsapp', ready: false, provider: null, note: 'Brak providera wysylki dla kanalu whatsapp' },
          ],
        },
      });
    }
    if (url === '/crm/command-center') {
      return Promise.resolve({
        data: {
          summary: { critical: 1, high: 1, unassigned: 1, phone_unassigned: 1, phone_followups: 2, phone_followups_overdue: 1, value_at_risk: 9000 },
          priorities: [
            {
              id: 77,
              title: 'Duza wycinka przy domu',
              stage: 'Lead',
              priority: 'critical',
              score: 92,
              value: 9000,
              next_best_action: 'Przypisz ownera i zaplanuj pierwszy kontakt.',
              reasons: [
                { key: 'unassigned', label: 'Brak ownera' },
                { key: 'high_value', label: 'Wysoka wartosc: 9000 PLN' },
              ],
            },
          ],
        },
      });
    }
    if (url === '/oddzialy') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
  api.patch.mockResolvedValue({ data: {} });
  api.post.mockResolvedValue({ data: { processed: 1, sent: 1, failed: 0 } });
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('renders CRM conversion analytics and owner performance', async () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CrmDashboard />
    </MemoryRouter>
  );

  expect(await screen.findByText('Konwersja CRM')).toBeInTheDocument();
  expect(screen.getByText('Aktywność ownerów')).toBeInTheDocument();
  expect(screen.getByText('Anna CRM')).toBeInTheDocument();
  expect(screen.getByText('Satysfakcja klientów')).toBeInTheDocument();
  expect(screen.getByText('Średnia ocena')).toBeInTheDocument();
  expect(screen.getByText('Co zrobić teraz')).toBeInTheDocument();
  expect(screen.getByText('Duza wycinka przy domu')).toBeInTheDocument();
  expect(screen.getByText('Przypisz ownera i zaplanuj pierwszy kontakt.')).toBeInTheDocument();
  expect(screen.getByText('Tel. bez ownera')).toBeInTheDocument();
  expect(screen.getByText('Po rozmowach')).toBeInTheDocument();
  expect(screen.getByText('Wartość zagrożona')).toBeInTheDocument();
  expect(screen.getAllByText('whatsapp').length).toBeGreaterThan(0);
  expect(screen.getByText('Wygrane/przegrane: 1/1')).toBeInTheDocument();
});

test('renders and updates CRM message send queue', async () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CrmDashboard />
    </MemoryRouter>
  );

  expect(await screen.findByText('Kolejka wysylki')).toBeInTheDocument();
  expect(screen.getByText('email')).toBeInTheDocument();
  expect(screen.getByText('smtp')).toBeInTheDocument();
  expect(screen.getByText('Oferta ogrodu')).toBeInTheDocument();
  expect(screen.getByText('Dzien dobry, wracam z oferta.')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Wyslane' }));

  await waitFor(() => {
    expect(api.patch).toHaveBeenCalledWith(
      '/crm/messages/501/status',
      { status: 'sent', error: undefined },
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});

test('can trigger CRM message queue processing', async () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CrmDashboard />
    </MemoryRouter>
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Uruchom kolejke' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/crm/messages/queue/process',
      { limit: 10 },
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  expect(await screen.findByText('Kolejka przetworzona: 1 wyslane, 0 bledy.')).toBeInTheDocument();
});
