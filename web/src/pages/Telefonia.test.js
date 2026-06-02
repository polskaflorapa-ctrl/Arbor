import '../i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import Telefonia from './Telefonia';
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
}));

const USER_JSON = JSON.stringify({
  id: 1,
  rola: 'Dyrektor',
  imie: 'Anna',
  nazwisko: 'Telefon',
});

function renderTelefonia(initialPath = '/telefonia') {
  return render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/telefonia" element={<Telefonia />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.setItem('token', 'test-jwt-telefonia');
  localStorage.setItem('user', USER_JSON);
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.put.mockReset();
  api.post.mockResolvedValue({ data: { message: 'OK' } });
  api.put.mockResolvedValue({ data: { success: true } });
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
  api.get.mockImplementation((url) => {
    const path = String(url).split('?')[0];
    if (path === '/oddzialy') {
      return Promise.resolve({ data: [{ id: 7, nazwa: 'Oddzial Krakow' }] });
    }
    if (path === '/sms/historia') {
      return Promise.resolve({
        data: {
          total: 1,
          limit: 15,
          offset: 0,
          items: [{
            id: 9,
            task_id: 42,
            telefon: '+48123123123',
            tresc: 'Test',
            status: 'failed',
            provider_status: 'failed',
            error: 'provider timeout',
            klient_nazwa: 'Jan Test',
            typ_uslugi: 'Wycena',
            oddzial_id: 7,
            oddzial_nazwa: 'Oddzial Krakow',
            owner_role: 'Kierownik/Dyspozytor',
            owner_label: 'Kierownik/Dyspozytor - kontakt z klientem',
            escalation: 'P2 gdy brak dostarczenia po 30 min',
          }],
        },
      });
    }
    if (path === '/telephony/voice-agent/polska-flora/integrations/status') {
      return Promise.resolve({
        data: {
          items: [{
            oddzial_id: 7,
            oddzial_name: 'Oddzial Krakow',
            miasto: 'Krakow',
            telefon: '',
            sms_sender_id: '',
            integration_id: null,
            integration_status: null,
            provider: null,
            provider_account_id: null,
            intakes_total: 0,
            needs_review: 0,
            sms_errors: 0,
            last_test_log_at: null,
            last_test_log_status: null,
          }],
        },
      });
    }
    if (path === '/telephony/voice-agent/polska-flora/integration') {
      return Promise.resolve({ data: { config: {}, integration: null } });
    }
    if (path === '/telephony/voice-agent/polska-flora/intakes') {
      return Promise.resolve({ data: { items: [], total: 0, summary: {} } });
    }
    if (path === '/automations/inspection-sms-reminders/preview') {
      return Promise.resolve({ data: { total: 0, items: [] } });
    }
    if (path === '/telephony/integration-test-logs') {
      return Promise.resolve({ data: { items: [] } });
    }
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('filters SMS history by branch and acknowledges delivery owner alert', async () => {
  renderTelefonia();

  expect(await screen.findByText('SMS-9')).toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText('Filtr oddzialu SMS'), '7');

  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining('/sms/historia?'),
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(api.get.mock.calls.some(([url]) => String(url).includes('oddzial_id=7'))).toBe(true);
  });

  await userEvent.click(screen.getByRole('button', { name: 'Potwierdz' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/ops/risk-report/actions',
      expect.objectContaining({
        action: 'acknowledge',
        risk_type: 'sms_delivery',
        risk_id: 'sms_delivery:9',
        task_id: 42,
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});

test('one-click branch telephony setup saves branch numbers before copying provider package', async () => {
  api.post.mockImplementation((url) => {
    if (url === '/telephony/voice-agent/polska-flora/integration') {
      return Promise.resolve({
        data: {
          config: {},
          integration: {
            id: 31,
            oddzial_id: 7,
            provider: 'zadarma',
            status: 'active',
            webhook_url: '/api/telephony/voice-agent/polska-flora/intake',
            webhook_secret: 'secret-krk',
          },
        },
      });
    }
    return Promise.resolve({ data: { message: 'OK' } });
  });

  renderTelefonia();

  await userEvent.click(await screen.findByRole('button', { name: 'Agent AI' }));
  expect(await screen.findByText('Szybki start oddzialu')).toBeInTheDocument();

  await userEvent.type(screen.getByPlaceholderText('+48...'), '+48111222333');
  await userEvent.type(screen.getByPlaceholderText('np. ARBOR-KRK albo numer SMS'), 'ARBOR-KRK');
  await userEvent.click(screen.getAllByRole('button', { name: 'Przygotuj jednym kliknieciem' })[0]);

  await waitFor(() => {
    expect(api.put).toHaveBeenCalledWith(
      '/oddzialy/7',
      { telefon: '48111222333', sms_sender_id: 'ARBOR-KRK' },
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  expect(api.post).toHaveBeenCalledWith(
    '/telephony/voice-agent/polska-flora/integration',
    expect.objectContaining({ oddzial_id: 7, provider: 'zadarma', status: 'active' }),
    expect.objectContaining({ headers: expect.any(Object) })
  );
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('48111222333'));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('ARBOR-KRK'));
});

test('specialist can register an incoming client call and create callback', async () => {
  renderTelefonia();

  await userEvent.click(await screen.findByRole('button', { name: /oddzwonienia/i }));
  expect(await screen.findByText('Przyjmij telefon od klienta')).toBeInTheDocument();

  const selects = screen.getAllByRole('combobox');
  await userEvent.selectOptions(selects[0], '7');
  await userEvent.type(screen.getByPlaceholderText('Telefon klienta'), '+48600111222');
  await userEvent.type(screen.getByPlaceholderText('Klient / firma'), 'Jan Klient');
  await userEvent.selectOptions(selects[1], 'missed');
  await userEvent.type(screen.getByPlaceholderText('Co klient powiedzial / czego potrzebuje...'), 'Prosi o pilny kontakt');
  await userEvent.click(screen.getByRole('button', { name: 'Zapisz przychodzace' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/telephony/calls',
      expect.objectContaining({
        oddzial_id: 7,
        phone: '+48600111222',
        call_type: 'inbound',
        status: 'missed',
        lead_name: 'Jan Klient',
        notes: 'Prosi o pilny kontakt',
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  expect(api.post).toHaveBeenCalledWith(
    '/crm/leads',
    expect.objectContaining({
      title: 'Jan Klient',
      oddzial_id: 7,
      stage: 'Lead',
      source: 'telefonia',
      phone: '+48600111222',
      tags: ['telefonia', 'telefon-przychodzacy'],
    }),
    expect.objectContaining({ headers: expect.any(Object) })
  );
  expect(api.post).toHaveBeenCalledWith(
    '/telephony/callbacks',
    expect.objectContaining({
      oddzial_id: 7,
      phone: '+48600111222',
      priority: 'high',
      lead_name: 'Jan Klient',
    }),
    expect.objectContaining({ headers: expect.any(Object) })
  );
  expect(await screen.findByText(/Telefon przychodzacy zapisany/i)).toBeInTheDocument();
  expect(screen.getByText(/Lead CRM utworzony/i)).toBeInTheDocument();
  expect(screen.getByText(/Oddzwonienie utworzone/i)).toBeInTheDocument();
});
