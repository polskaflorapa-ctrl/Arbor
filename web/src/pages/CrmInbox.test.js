import '../i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import CrmInbox from './CrmInbox';
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
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'crm-inbox-token');
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.get.mockImplementation((url) => {
    if (url === '/crm/message-templates') {
      return Promise.resolve({
        data: [
          {
            id: 31,
            name: 'Follow-up wycena',
            channel: 'whatsapp',
            body: 'Dzien dobry, wracam z wycena dla {title}.',
          },
        ],
      });
    }
    if (url === '/crm/integrations/apps') {
      return Promise.resolve({
        data: [
          {
            id: 41,
            oddzial_id: 7,
            name: 'WhatsApp / Krakow',
            type: 'webhook',
            active: true,
            webhook_path: '/api/webhooks/crm/tok_wa',
            config: { unified_inbox: true, channel: 'whatsapp', provider: 'meta' },
          },
          {
            id: 42,
            oddzial_id: 8,
            name: 'E-mail / Warszawa',
            type: 'webhook',
            active: true,
            webhook_path: '/api/webhooks/crm/tok_mail',
            config: { unified_inbox: true, channel: 'email', provider: 'sendgrid' },
          },
        ],
      });
    }
    if (url === '/uzytkownicy') {
      return Promise.resolve({
        data: [
          { id: 9, imie: 'Anna', nazwisko: 'Kowalska', login: 'anna' },
          { id: 10, imie: 'Piotr', nazwisko: 'Nowak', login: 'piotr' },
        ],
      });
    }
    if (url === '/crm/leads/22/messages') {
      return Promise.resolve({
        data: [
          {
            id: 702,
            lead_id: 22,
            channel: 'whatsapp',
            direction: 'outbound',
            status: 'sent',
            body: 'Dzien dobry, przygotujemy wycene.',
            created_at: '2026-05-28T08:05:00.000Z',
          },
          {
            id: 701,
            lead_id: 22,
            channel: 'whatsapp',
            direction: 'inbound',
            status: 'received',
            body: 'Prosze o szybka wycene.',
            created_at: '2026-05-28T08:00:00.000Z',
          },
        ],
      });
    }
    return Promise.resolve({
      data: [
        {
          id: 701,
          lead_id: 22,
          lead_title: 'Oferta ogrodu',
          channel: 'whatsapp',
          direction: 'inbound',
          status: 'received',
          sender_handle: '+48500100200',
          owner_user_id: 9,
          owner_name: 'Anna Kowalska',
          body: 'Prosze o szybka wycene.',
          created_at: '2026-05-28T08:00:00.000Z',
        },
      ],
    });
  });
  api.post.mockResolvedValue({ data: { id: 702, status: 'queued' } });
  api.patch.mockResolvedValue({ data: { id: 701, status: 'read' } });
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('renders unified CRM inbox and applies filters', async () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CrmInbox />
    </MemoryRouter>
  );

  expect(await screen.findByRole('heading', { name: 'Unified Inbox' })).toBeInTheDocument();
  expect(screen.getAllByText('Oferta ogrodu').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Prosze o szybka wycene.').length).toBeGreaterThan(0);
  expect(await screen.findByText('Historia rozmowy')).toBeInTheDocument();
  expect(await screen.findByText('Dzien dobry, przygotujemy wycene.')).toBeInTheDocument();
  expect(await screen.findByText('Zrodla kanalow')).toBeInTheDocument();
  expect(screen.getByText(/Gotowe: 2\/6/)).toBeInTheDocument();
  expect(screen.getByText('1 aktywne zrodlo, rozmowy: 1')).toBeInTheDocument();
  expect(screen.getAllByText('Do podpiecia').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Brak webhooka dla tego kanalu').length).toBeGreaterThan(0);
  expect(screen.getByText('Oddzial 7 / meta')).toBeInTheDocument();
  expect(screen.getByText('Rozmowy w widoku: 1')).toBeInTheDocument();

  fireEvent.change(screen.getAllByDisplayValue('Wszystkie')[0], { target: { value: 'whatsapp' } });

  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith(
      '/crm/messages/inbox',
      expect.objectContaining({
        params: expect.objectContaining({ channel: 'whatsapp' }),
      })
    );
  });
});

test('explains stale backend 404 for unified inbox route', async () => {
  api.get.mockImplementation((url) => {
    if (url === '/crm/messages/inbox') {
      return Promise.reject({
        response: {
          status: 404,
          data: { path: '/api/crm/messages/inbox' },
        },
        config: { url },
      });
    }
    return Promise.resolve({ data: [] });
  });

  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CrmInbox />
    </MemoryRouter>
  );

  expect(await screen.findByText(/backend nie ma aktualnej trasy/i)).toBeInTheDocument();
  expect(screen.getByText(/Zrestartuj backend/i)).toBeInTheDocument();
});

test('filters inbox from configured channel sources', async () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CrmInbox />
    </MemoryRouter>
  );

  fireEvent.click(await screen.findByText('E-mail'));

  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith(
      '/crm/messages/inbox',
      expect.objectContaining({
        params: expect.objectContaining({ channel: 'email' }),
      })
    );
  });
});

test('refreshes channel sources from unified inbox', async () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CrmInbox />
    </MemoryRouter>
  );

  await screen.findByText('Zrodla kanalow');
  const initialCalls = api.get.mock.calls.filter(([url]) => url === '/crm/integrations/apps').length;

  fireEvent.click(screen.getByRole('button', { name: 'Odswiez zrodla' }));

  await waitFor(() => {
    const nextCalls = api.get.mock.calls.filter(([url]) => url === '/crm/integrations/apps').length;
    expect(nextCalls).toBeGreaterThan(initialCalls);
  });
});

test('adds a reply from unified inbox to the send queue', async () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CrmInbox />
    </MemoryRouter>
  );

  fireEvent.change(await screen.findByPlaceholderText('Napisz odpowiedz do klienta...'), {
    target: { value: 'Dzien dobry, przygotujemy wycene.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Dodaj do kolejki' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/crm/leads/22/messages',
      expect.objectContaining({
        channel: 'whatsapp',
        direction: 'outbound',
        status: 'queued',
        recipient_handle: '+48500100200',
        body: 'Dzien dobry, przygotujemy wycene.',
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  expect(await screen.findByText('Odpowiedz dodana do kolejki wysylki.')).toBeInTheDocument();
});

test('uses a message template when replying from unified inbox', async () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CrmInbox />
    </MemoryRouter>
  );

  fireEvent.change(await screen.findByDisplayValue('Bez szablonu'), { target: { value: '31' } });
  expect(screen.getByDisplayValue('Dzien dobry, wracam z wycena dla {title}.')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Dodaj do kolejki' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/crm/leads/22/messages',
      expect.objectContaining({
        template_id: 31,
        body: 'Dzien dobry, wracam z wycena dla {title}.',
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});

test('updates a message status from unified inbox actions', async () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CrmInbox />
    </MemoryRouter>
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Przeczytane' }));

  await waitFor(() => {
    expect(api.patch).toHaveBeenCalledWith(
      '/crm/messages/701/status',
      { status: 'read', error: undefined },
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  expect(await screen.findByText('Status wiadomosci zmieniony na read.')).toBeInTheDocument();
});

test('assigns a lead owner from unified inbox', async () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CrmInbox />
    </MemoryRouter>
  );

  fireEvent.change(await screen.findByDisplayValue('Anna Kowalska'), { target: { value: '10' } });

  await waitFor(() => {
    expect(api.patch).toHaveBeenCalledWith(
      '/crm/leads/22',
      { owner_user_id: 10 },
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  expect(await screen.findByText('Handlowiec przypisany do rozmowy.')).toBeInTheDocument();
});
