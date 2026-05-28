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

  expect(await screen.findByText('Unified Inbox')).toBeInTheDocument();
  expect(screen.getAllByText('Oferta ogrodu').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Prosze o szybka wycene.').length).toBeGreaterThan(0);

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
