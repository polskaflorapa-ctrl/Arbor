import '../i18n';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import DemoRequests from './DemoRequests';
import api from '../api';

vi.mock('../components/CommandSidebar', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../components/PageHeader', () => ({
  __esModule: true,
  default: ({ title, subtitle, actions }) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {actions}
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
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

const todayIso = () => `${new Date().toISOString().slice(0, 10)}T08:30:00.000Z`;

const demoItems = [
  {
    id: 1,
    name: 'Anna Kontakt',
    email: 'anna@example.test',
    company: 'Pilne Drzewa',
    phone: '+48 500 100 200',
    message: 'Chcemy demo jeszcze dzis.',
    source: 'landing-page',
    status: 'new',
    sales_note: '',
    client_id: null,
    created_at: todayIso(),
  },
  {
    id: 2,
    name: 'Bartek Bez Telefonu',
    email: 'bartek@example.test',
    company: 'Cichy Ogrod',
    phone: '',
    message: '',
    source: 'landing-page',
    status: 'new',
    sales_note: '',
    client_id: null,
    created_at: '2026-05-01T10:00:00.000Z',
  },
  {
    id: 3,
    name: 'Celina CRM',
    email: 'celina@example.test',
    company: 'Klient W CRM',
    phone: '+48 600 111 222',
    message: 'Juz skonwertowany.',
    source: 'landing-page',
    status: 'qualified',
    sales_note: '',
    client_id: 44,
    created_at: todayIso(),
  },
  {
    id: 4,
    name: 'Daniel Zamkniety',
    email: 'daniel@example.test',
    company: 'Zamkniety Lead',
    phone: '+48 700 111 222',
    message: 'Nieaktualne.',
    source: 'landing-page',
    status: 'closed',
    sales_note: '',
    client_id: null,
    created_at: todayIso(),
  },
];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'demo-requests-token');
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.get.mockResolvedValue({ data: { items: demoItems, total: demoItems.length } });
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DemoRequests />
    </MemoryRouter>
  );
}

test('prioritizes open demo leads that need contact by default', async () => {
  renderPage();

  expect(await screen.findByText('Pilne Drzewa')).toBeInTheDocument();
  expect(screen.getByText('Cichy Ogrod')).toBeInTheDocument();
  expect(screen.queryByText('Klient W CRM')).not.toBeInTheDocument();
  expect(screen.queryByText('Zamkniety Lead')).not.toBeInTheDocument();
  expect(screen.getByText('2 widocznych')).toBeInTheDocument();
  expect(screen.getAllByText('Najpierw dzwon')).toHaveLength(2);
  expect(screen.getByText('Brak telefonu')).toBeInTheDocument();

  const rows = screen.getAllByRole('row').slice(1);
  expect(within(rows[0]).getByText('Pilne Drzewa')).toBeInTheDocument();
  expect(within(rows[1]).getByText('Cichy Ogrod')).toBeInTheDocument();
});

test('filters demo requests to already converted CRM clients', async () => {
  renderPage();

  await screen.findByText('Pilne Drzewa');
  await userEvent.click(screen.getByRole('button', { name: 'W CRM' }));

  expect(screen.getByText('Klient W CRM')).toBeInTheDocument();
  expect(screen.getByText('Klient #44')).toBeInTheDocument();
  expect(screen.queryByText('Pilne Drzewa')).not.toBeInTheDocument();
  expect(screen.getByText('1 widocznych')).toBeInTheDocument();

  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith('/demo-requests?limit=100', expect.any(Object));
  });
});
