import '../i18n';
import { render, screen } from '@testing-library/react';
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
  },
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'crm-dashboard-token');
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    if (url === '/crm/overview') {
      return Promise.resolve({
        data: {
          kpis: { lead_win_rate: 33 },
          pipeline: [],
          sources: [{ source: 'whatsapp', count: 3, won: 1, lost: 1, conversion_rate: 33 }],
          analytics: {
            conversion: { open: 1, won: 1, lost: 1, technical: 0, open_rate: 33, win_rate: 33, loss_rate: 33 },
            owners: [{ owner_user_id: 21, owner_name: 'Anna CRM', open: 1, won: 1, lost: 0, conversion_rate: 50, won_value: 1200 }],
          },
          callbacks: [],
        },
      });
    }
    if (url === '/oddzialy') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
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
  expect(screen.getByText('whatsapp')).toBeInTheDocument();
  expect(screen.getByText('Wygrane/przegrane: 1/1')).toBeInTheDocument();
});
