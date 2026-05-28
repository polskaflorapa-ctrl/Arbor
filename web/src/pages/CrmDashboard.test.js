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
  },
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'crm-dashboard-token');
  api.get.mockReset();
  api.patch.mockReset();
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
    if (url === '/oddzialy') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
  api.patch.mockResolvedValue({ data: {} });
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
  expect(screen.getByText('whatsapp')).toBeInTheDocument();
  expect(screen.getByText('Wygrane/przegrane: 1/1')).toBeInTheDocument();
});

test('renders and updates CRM message send queue', async () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CrmDashboard />
    </MemoryRouter>
  );

  expect(await screen.findByText('Kolejka wysylki')).toBeInTheDocument();
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
