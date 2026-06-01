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

function setupGetMocks({ crmApps = [], branchStatuses = null } = {}) {
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
      return Promise.resolve({ data: crmApps });
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
    if (path === '/telephony/voice-agent/polska-flora/integrations/status') {
      return Promise.resolve({
        data: {
          items: branchStatuses || [{
            oddzial_id: 2,
            oddzial_name: 'Oddzial Krakow',
            telefon: '+48111222333',
            sms_sender_id: 'ARBOR',
            integration_status: 'active',
            last_test_log_status: 'ok',
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
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
  window.URL.createObjectURL = vi.fn(() => 'blob:checklist');
  window.URL.revokeObjectURL = vi.fn();
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

  test('copies provider package for an existing Unified Inbox channel', async () => {
    setupGetMocks({
      crmApps: [{
        id: 7,
        name: 'WhatsApp Krakow',
        type: 'webhook',
        oddzial_id: 2,
        active: true,
        webhook_path: '/api/webhooks/crm/tok_wa',
        config: {
          unified_inbox: true,
          channel: 'whatsapp',
          provider: 'meta',
          handle: '+48111222333',
        },
      }],
    });

    renderIntegracje();

    await screen.findByText('WhatsApp Krakow');
    await userEvent.click(screen.getByRole('button', { name: /Kopiuj paczke/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('"channel": "whatsapp"'));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('"oddzial_id": 2'));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('/api/webhooks/crm/tok_wa'));
    });
    expect(await screen.findByText(/Paczka kanalu skopiowana/i)).toBeInTheDocument();
  });

  test('pauses an existing Unified Inbox channel from the integrations panel', async () => {
    setupGetMocks({
      crmApps: [{
        id: 7,
        name: 'WhatsApp Krakow',
        type: 'webhook',
        oddzial_id: 2,
        active: true,
        webhook_path: '/api/webhooks/crm/tok_wa',
        config: {
          unified_inbox: true,
          channel: 'whatsapp',
          provider: 'meta',
        },
      }],
    });
    api.patch.mockResolvedValueOnce({ data: { id: 7, active: false } });

    renderIntegracje();

    await screen.findByText('WhatsApp Krakow');
    await userEvent.click(screen.getByRole('button', { name: /Pauzuj/i }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith(
        '/crm/integrations/apps/7',
        { active: false },
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
    expect(await screen.findByText(/Kanal Unified Inbox zatrzymany/i)).toBeInTheDocument();
  });

  test('shows branch setup checklist combining telephony and Unified Inbox status', async () => {
    setupGetMocks({
      crmApps: [{
        id: 7,
        name: 'WhatsApp Krakow',
        type: 'webhook',
        oddzial_id: 2,
        active: true,
        webhook_path: '/api/webhooks/crm/tok_wa',
        config: {
          unified_inbox: true,
          channel: 'whatsapp',
          provider: 'meta',
        },
      }],
    });

    renderIntegracje();

    expect(await screen.findByText('Checklisty podpiecia oddzialow')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByDisplayValue('Tylko do dopiecia'), 'all');
    expect(await screen.findByText('Oddzial Krakow')).toBeInTheDocument();
    expect(screen.getByText(/Gotowe: 1\/1/i)).toBeInTheDocument();
    expect(screen.getByText(/5\/5 gotowe/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Gotowy/i).length).toBeGreaterThan(0);
  });

  test('copies checklist gaps and prepares missing Inbox channel for a branch', async () => {
    setupGetMocks({
      crmApps: [],
      branchStatuses: [{
        oddzial_id: 3,
        oddzial_name: 'Oddzial Gdansk',
        telefon: '+48555111222',
        sms_sender_id: '',
        integration_status: 'paused',
        last_test_log_status: 'error',
      }],
    });

    renderIntegracje();

    expect(await screen.findByText('Oddzial Gdansk')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Kopiuj braki/i }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Oddzial Gdansk'));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('kanal inbox'));
    });

    await userEvent.click(screen.getByRole('button', { name: 'Kopiuj komplet' }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Paczka podpiecia oddzialu: Oddzial Gdansk'));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Telefon oddzialu: +48555111222'));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('- Dopiac: kanal inbox'));
    });

    await userEvent.click(screen.getByRole('button', { name: 'Kopiuj komplety' }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Zbiorcze paczki podpiecia oddzialow'));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Widoczne oddzialy: 1/1'));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Paczka podpiecia oddzialu: Oddzial Gdansk'));
    });

    await userEvent.click(screen.getByRole('button', { name: /Formularz/i }));
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+48555111222')).toBeInTheDocument();
  });

  test('orders branch setup checklist by biggest gaps and shows test state', async () => {
    setupGetMocks({
      crmApps: [{
        id: 11,
        oddzial_id: 8,
        active: true,
        config: { unified_inbox: true, channel: 'whatsapp' },
      }],
      branchStatuses: [
        {
          oddzial_id: 8,
          oddzial_name: 'Oddzial Gotowy',
          telefon: '+48111000000',
          sms_sender_id: 'ARBOR',
          integration_status: 'active',
          last_test_log_status: 'ok',
        },
        {
          oddzial_id: 4,
          oddzial_name: 'Oddzial Najwiecej Brakow',
          telefon: '',
          sms_sender_id: '',
          integration_status: 'paused',
          last_test_log_status: '',
        },
        {
          oddzial_id: 5,
          oddzial_name: 'Oddzial Sredni',
          telefon: '+48555000000',
          sms_sender_id: '',
          integration_status: 'active',
          last_test_log_status: 'error',
        },
      ],
    });

    renderIntegracje();

    await userEvent.selectOptions(screen.getByDisplayValue('Tylko do dopiecia'), 'all');

    const worst = await screen.findByText('Oddzial Najwiecej Brakow');
    const middle = await screen.findByText('Oddzial Sredni');
    const ready = await screen.findByText('Oddzial Gotowy');

    expect(worst.compareDocumentPosition(middle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(middle.compareDocumentPosition(ready) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText('Brak testu').length).toBeGreaterThan(0);
    expect(screen.getByText('Test nieudany')).toBeInTheDocument();
    expect(screen.getByText('Test wyslany')).toBeInTheDocument();
  });

  test('creates and tests a missing Inbox channel directly from branch checklist', async () => {
    setupGetMocks({
      crmApps: [],
      branchStatuses: [{
        oddzial_id: 3,
        oddzial_name: 'Oddzial Gdansk',
        telefon: '+48555111222',
        sms_sender_id: '',
        integration_status: 'paused',
        last_test_log_status: 'error',
      }],
    });
    api.post.mockResolvedValueOnce({
      data: {
        id: 77,
        token: 'tok_branch',
        webhook_path: '/api/webhooks/crm/tok_branch',
      },
    });
    api.post.mockResolvedValueOnce({ data: { lead_id: 901 } });

    renderIntegracje();

    expect(await screen.findByText('Oddzial Gdansk')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Utworz i testuj Inbox/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/crm/integrations/apps',
        expect.objectContaining({
          name: 'WhatsApp / +48555111222',
          type: 'webhook',
          oddzial_id: 3,
          config: expect.objectContaining({
            channel: 'whatsapp',
            provider: 'meta',
            handle: '+48555111222',
            unified_inbox: true,
          }),
        }),
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(api.post).toHaveBeenCalledWith(
        '/webhooks/crm/tok_branch',
        expect.objectContaining({
          event_type: 'message.received',
          channel: 'whatsapp',
          sender_handle: '+48555111222',
          tags: expect.arrayContaining(['unified-inbox', 'test', 'whatsapp']),
        })
      );
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('/api/webhooks/crm/tok_branch'));
    });
    expect(await screen.findByText(/Kanal Inbox utworzony i przetestowany dla Oddzial Gdansk/i)).toBeInTheDocument();
    expect(await screen.findByText(/Lead #901/i)).toBeInTheDocument();
  });

  test('exports branch setup checklist as CSV', async () => {
    const clickMock = vi.fn();
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = originalCreateElement(tagName, options);
      if (String(tagName).toLowerCase() === 'a') {
        element.click = clickMock;
      }
      return element;
    });
    setupGetMocks({
      crmApps: [],
      branchStatuses: [{
        oddzial_id: 3,
        oddzial_name: 'Oddzial Gdansk',
        telefon: '+48555111222',
        sms_sender_id: '',
        integration_status: 'paused',
        last_test_log_status: 'error',
      }],
    });

    renderIntegracje();

    expect(await screen.findByText('Oddzial Gdansk')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /Eksport CSV/i })[0]);

    expect(window.URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(appendSpy).toHaveBeenCalledWith(expect.objectContaining({
      download: expect.stringMatching(/^checklista-oddzialow-/),
    }));
    expect(clickMock).toHaveBeenCalled();
    expect(await screen.findByText(/Eksport checklisty gotowy/i)).toBeInTheDocument();
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
