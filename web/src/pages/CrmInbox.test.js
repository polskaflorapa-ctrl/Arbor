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
  },
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'crm-inbox-token');
  api.get.mockReset();
  api.get.mockResolvedValue({
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
