import '../i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import Integracje from './Integracje';
import api from '../api';

vi.mock('../components/Sidebar', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
  },
  API: '/api',
}));

const USER_JSON = JSON.stringify({ rola: 'Dyrektor', imie: 'Test', nazwisko: 'User' });

function setupGetMocks() {
  api.get.mockImplementation((url) => {
    const path = String(url).split('?')[0];
    if (path === '/notifications') {
      return Promise.resolve({ data: { notifications: [], unread_count: 0 } });
    }
    if (path === '/integrations/stats') {
      return Promise.resolve({
        data: {
          total: 3,
          sent_demo: 2,
          byChannel: { sms: 1, email: 1, push: 1 },
        },
      });
    }
    if (path === '/integrations/logs') {
      return Promise.resolve({
        data: {
          items: [
            {
              id: 'l1',
              created_at: '2026-04-20T12:00:00.000Z',
              channel: 'sms',
              status: 'sent_demo',
              task_id: 't1',
              title: 'Demo',
            },
          ],
          total_pages: 1,
          total: 1,
        },
      });
    }
    if (path === '/integrations/retry-audit') {
      return Promise.resolve({ data: [] });
    }
    if (path === '/integrations/security') {
      return Promise.resolve({
        data: { denylist: { users: [], channels: [] }, denylist_history: [] },
      });
    }
    if (path === '/uzytkownicy') {
      return Promise.resolve({ data: [] });
    }
    if (path === '/crm/integrations/apps') {
      return Promise.resolve({ data: [] });
    }
    if (path === '/crm/integrations/events') {
      return Promise.resolve({ data: [] });
    }
    if (path === '/tasks/kommo-sync/diagnostics') {
      return Promise.resolve({
        data: {
          summary: { queue_errors: 1, inbound_conflicts: 1 },
          queue: [{
            id: 10,
            task_id: 101,
            klient_nazwa: 'Test Klient',
            status: 'dead_letter',
            retry_count: 3,
            last_error: 'HTTP 500',
          }],
          inbound_events: [{
            id: 20,
            task_id: 102,
            status: 'conflict',
            incoming_status: 'Anulowane',
            conflict_reason: 'Zlecenie jest juz zamkniete',
            created_at: '2026-05-28T08:00:00.000Z',
          }],
        },
      });
    }
    return Promise.reject(new Error(`unmocked GET ${url}`));
  });
}

function renderIntegracje() {
  return render(
    <MemoryRouter
      initialEntries={['/integracje']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/integracje" element={<Integracje />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.setItem('token', 'test-jwt-integration');
  localStorage.setItem('user', USER_JSON);
  api.get.mockReset();
  api.post.mockReset();
  api.post.mockResolvedValue({ data: { retried: 1 } });
  api.patch.mockReset();
  api.patch.mockResolvedValue({ data: {} });
  api.put.mockReset();
  api.put.mockResolvedValue({ data: {} });
  setupGetMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('Integracje (integration-style)', () => {
  test('renders dashboard with stats and log row when session + API succeed', async () => {
    renderIntegracje();

    expect(await screen.findByRole('heading', { name: /Integracje/i })).toBeInTheDocument();
    expect(screen.getByText(/Globalny dashboard logów i retry/i)).toBeInTheDocument();
    expect(await screen.findByText('Wszystkie logi')).toBeInTheDocument();
    expect(await screen.findByText('Kommo task.sync')).toBeInTheDocument();
    expect(await screen.findByText('Bledy: 1')).toBeInTheDocument();
    expect(await screen.findByText('Konflikty: 1')).toBeInTheDocument();
    expect(await screen.findByText('Wyniki: 1')).toBeInTheDocument();
    expect(await screen.findByText('#t1')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Retry$/ })).toBeInTheDocument();
    expect(screen.getByText(/Retry gotowe/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringMatching(/^\/integrations\/logs/),
        expect.any(Object)
      );
    });
  });

  test('single log retry calls POST /integrations/logs/:id/retry', async () => {
    renderIntegracje();

    await screen.findByRole('button', { name: /^Retry$/ });
    await userEvent.click(screen.getByRole('button', { name: /^Retry$/ }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/integrations/logs/l1/retry',
        {},
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
  });

  test('retry batch without selection does not call batch endpoint', async () => {
    renderIntegracje();

    await screen.findByRole('button', { name: /Retry batch/i });
    await userEvent.click(screen.getByRole('button', { name: /Retry batch/i }));

    expect(api.post).not.toHaveBeenCalledWith(
      '/integrations/logs/retry-batch',
      expect.anything(),
      expect.anything()
    );
  });

  test('auto-refresh checkbox toggles without throwing', async () => {
    renderIntegracje();

    await screen.findByText(/Auto-refresh 10s/i);
    const boxes = screen.getAllByRole('checkbox');
    const auto = boxes[0];
    expect(auto).toBeChecked();
    await userEvent.click(auto);
    expect(auto).not.toBeChecked();
    await userEvent.click(auto);
    expect(auto).toBeChecked();
  });

  test('creates a CRM integration app from the integrations panel', async () => {
    api.post.mockResolvedValueOnce({ data: { token: 'tok_123' } });
    renderIntegracje();

    await screen.findByText('CRM API / widgety');
    await userEvent.click(screen.getByRole('button', { name: /Dodaj CRM app/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/crm/integrations/apps',
        expect.objectContaining({ name: 'Landing widget', type: 'widget' }),
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
  });

  test('redirects away when JWT is missing (guest)', async () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');

    render(
      <MemoryRouter
        initialEntries={['/integracje']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/" element={<div data-testid="login-gate">login</div>} />
          <Route path="/integracje" element={<Integracje />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('login-gate')).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: /Integracje/i })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith(
      expect.stringMatching(/^\/integrations\/logs/),
      expect.anything()
    );
  });
});
