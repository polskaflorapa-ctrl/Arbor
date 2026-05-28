import '../i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import CrmPipeline from './CrmPipeline';
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
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'crm-test-token');
  localStorage.setItem('user', JSON.stringify({
    id: 9001,
    oddzial_id: 7,
    rola: 'Administrator',
    imie: 'Smoke',
    nazwisko: 'Admin',
  }));
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.delete.mockReset();
  api.get.mockImplementation((url) => {
    if (url === '/crm/leads') return Promise.resolve({ data: [] });
    if (url === '/oddzialy') return Promise.resolve({ data: [{ id: 7, nazwa: 'Smoke oddział' }] });
    if (url === '/uzytkownicy') return Promise.resolve({ data: [{ id: 9001, imie: 'Smoke', nazwisko: 'Admin' }] });
    if (url === '/klienci') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('prefills branch and owner for a new lead from stored user context', async () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CrmPipeline />
    </MemoryRouter>
  );

  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith('/crm/leads', expect.any(Object));
  });

  const selects = await screen.findAllByRole('combobox');
  expect(selects[0]).toHaveValue('7');
  expect(selects[1]).toHaveValue('9001');
});

test('lets a user add a unified inbox message to a lead', async () => {
  api.get.mockImplementation((url) => {
    if (url === '/crm/leads') {
      return Promise.resolve({
        data: [{
          id: 51,
          title: 'WhatsApp lead',
          stage: 'Lead',
          oddzial_id: 7,
          owner_user_id: 9001,
          value: 1500,
          phone: '+48500100200',
          source: 'whatsapp',
        }],
      });
    }
    if (url === '/crm/leads/51/activities') return Promise.resolve({ data: [] });
    if (url === '/crm/leads/51/messages') return Promise.resolve({ data: [] });
    if (url === '/oddzialy') return Promise.resolve({ data: [{ id: 7, nazwa: 'Smoke oddzial' }] });
    if (url === '/uzytkownicy') return Promise.resolve({ data: [{ id: 9001, imie: 'Smoke', nazwisko: 'Admin' }] });
    if (url === '/klienci') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
  api.post.mockResolvedValueOnce({
    data: {
      id: 77,
      lead_id: 51,
      channel: 'whatsapp',
      direction: 'inbound',
      body: 'Prosze o kontakt',
      status: 'received',
    },
  });

  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CrmPipeline />
    </MemoryRouter>
  );

  await screen.findByText('WhatsApp lead');
  await userEvent.click(screen.getByRole('button', { name: /Aktywno/i }));

  expect(await screen.findByText('Unified Inbox')).toBeInTheDocument();
  await userEvent.type(screen.getByPlaceholderText('Treść wiadomości...'), 'Prosze o kontakt');
  await userEvent.click(screen.getByRole('button', { name: 'Zapisz wiadomość' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/crm/leads/51/messages',
      expect.objectContaining({
        channel: 'whatsapp',
        direction: 'inbound',
        body: 'Prosze o kontakt',
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});

test('lets a user run AI assistant for a lead', async () => {
  api.get.mockImplementation((url) => {
    if (url === '/crm/leads') {
      return Promise.resolve({
        data: [{
          id: 51,
          title: 'AI lead',
          stage: 'Lead',
          oddzial_id: 7,
          owner_user_id: 9001,
          value: 1500,
          phone: '+48500100200',
          source: 'whatsapp',
        }],
      });
    }
    if (url === '/crm/leads/51/activities') return Promise.resolve({ data: [] });
    if (url === '/crm/leads/51/messages') return Promise.resolve({ data: [] });
    if (url === '/crm/workflows') return Promise.resolve({ data: [] });
    if (url === '/oddzialy') return Promise.resolve({ data: [{ id: 7, nazwa: 'Smoke oddzial' }] });
    if (url === '/uzytkownicy') return Promise.resolve({ data: [{ id: 9001, imie: 'Smoke', nazwisko: 'Admin' }] });
    if (url === '/klienci') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
  api.post.mockResolvedValueOnce({
    data: {
      summary: 'Klient czeka na kontakt.',
      next_best_action: 'Zadzwon dzis.',
      suggested_reply: 'Dzien dobry, oddzwonimy dzis.',
      lead_score: 72,
      risk: 'medium',
    },
  });

  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CrmPipeline />
    </MemoryRouter>
  );

  await screen.findByText('AI lead');
  await userEvent.click(screen.getByRole('button', { name: /Aktywno/i }));
  await screen.findByText('AI Lead Assistant');
  await userEvent.click(screen.getByRole('button', { name: 'Analizuj' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/crm/leads/51/ai-assistant',
      {},
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  expect(await screen.findByText('Klient czeka na kontakt.')).toBeInTheDocument();
  expect(screen.getByText('Zadzwon dzis.')).toBeInTheDocument();
});

test('lets a user create the default no-response workflow', async () => {
  api.post.mockResolvedValueOnce({
    data: {
      id: 31,
      oddzial_id: 7,
      name: 'Brak odpowiedzi 24h',
      trigger_type: 'no_response_after_hours',
      action_type: 'create_followup_task',
      active: true,
    },
  });

  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CrmPipeline />
    </MemoryRouter>
  );

  await screen.findByText('Automatyzacje');
  await userEvent.click(screen.getByRole('button', { name: /\+ brak odpowiedzi 24h/i }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/crm/workflows',
      expect.objectContaining({
        oddzial_id: 7,
        trigger_type: 'no_response_after_hours',
        action_type: 'create_followup_task',
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});

test('lets a user create a round-robin owner workflow', async () => {
  api.get.mockImplementation((url) => {
    if (url === '/crm/leads') return Promise.resolve({ data: [] });
    if (url === '/crm/workflows') return Promise.resolve({ data: [] });
    if (url === '/oddzialy') return Promise.resolve({ data: [{ id: 7, nazwa: 'Smoke oddzial' }] });
    if (url === '/uzytkownicy') {
      return Promise.resolve({
        data: [
          { id: 9001, imie: 'Smoke', nazwisko: 'Admin', oddzial_id: 7 },
          { id: 9002, imie: 'CRM', nazwisko: 'Owner', oddzial_id: 7 },
        ],
      });
    }
    if (url === '/klienci') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
  api.post.mockResolvedValueOnce({
    data: {
      id: 32,
      oddzial_id: 7,
      name: 'Round Robin leadow',
      trigger_type: 'unassigned_leads',
      action_type: 'assign_round_robin',
      action_config: { user_ids: [9001, 9002] },
      active: true,
    },
  });

  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CrmPipeline />
    </MemoryRouter>
  );

  await screen.findByText('Automatyzacje');
  await userEvent.click(screen.getByRole('button', { name: /\+ round-robin/i }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/crm/workflows',
      expect.objectContaining({
        oddzial_id: 7,
        trigger_type: 'unassigned_leads',
        action_type: 'assign_round_robin',
        action_config: { user_ids: [9001, 9002] },
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});
