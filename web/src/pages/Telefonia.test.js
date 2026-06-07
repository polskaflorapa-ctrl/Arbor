import '../i18n';
import { render, screen, waitFor, within } from '@testing-library/react';
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
    if (path === '/telephony/zadarma/settings') {
      return Promise.resolve({
        data: {
          configured: true,
          caller_id: 'ARBOR',
          api_key_masked: 'key***',
          sms_webhook_url: 'https://arbor.example/api/telephony/zadarma/sms/webhook',
        },
      });
    }
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  localStorage.clear();
  delete window.zadarmaWidgetFn;
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
  await waitFor(() => {
    expect(api.get.mock.calls.some(([url]) => String(url).startsWith('/telephony/integration-test-logs'))).toBe(true);
  });

  const branchPhoneInput = screen.getByPlaceholderText('+48...');
  const branchSmsSenderInput = screen.getByPlaceholderText('np. ARBOR-KRK albo numer SMS');
  await userEvent.clear(branchPhoneInput);
  await userEvent.type(branchPhoneInput, '+48111222333');
  await userEvent.clear(branchSmsSenderInput);
  await userEvent.type(branchSmsSenderInput, 'ARBOR-KRK');
  await waitFor(() => {
    expect(branchPhoneInput.value).toBe('+48111222333');
    expect(branchSmsSenderInput.value).toBe('ARBOR-KRK');
  });
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
}, 10000);

test('specialist can register an incoming client call and create callback', async () => {
  renderTelefonia();

  await userEvent.click(await screen.findByRole('button', { name: /oddzwonienia/i }));
  expect(await screen.findByText('Przyjmij telefon od klienta')).toBeInTheDocument();

  const incomingForm = screen.getByPlaceholderText('Telefon klienta').closest('form');
  const incoming = within(incomingForm);
  const selects = incoming.getAllByRole('combobox');
  await userEvent.selectOptions(selects[0], '7');
  await userEvent.type(incoming.getByPlaceholderText('Telefon klienta'), '+48600111222');
  await userEvent.type(incoming.getByPlaceholderText('Klient / firma'), 'Jan Klient');
  await userEvent.selectOptions(selects[1], 'missed');
  await userEvent.selectOptions(incoming.getByDisplayValue('Typ uslugi...'), 'ogrod');
  await userEvent.type(incoming.getByPlaceholderText('Adres ogledzin'), 'Lesna 5');
  await userEvent.type(incoming.getByPlaceholderText('Miasto'), 'Krakow');
  await userEvent.type(incoming.getByPlaceholderText('Co klient powiedzial / czego potrzebuje...'), 'Prosi o pilny kontakt');
  await userEvent.click(incoming.getByRole('button', { name: 'Zapisz przychodzace' }));

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
  const crmLeadCall = api.post.mock.calls.find(([url]) => url === '/crm/leads');
  expect(crmLeadCall?.[1].notes).toContain('Typ uslugi: ogrod');
  expect(crmLeadCall?.[1].notes).toContain('Adres ogledzin: Lesna 5');
  expect(crmLeadCall?.[1].notes).toContain('Miasto: Krakow');
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

test('runs phone CRM flow test from calls tab', async () => {
  api.post.mockImplementation((url) => {
    if (url === '/telefon/test-flow') {
      return Promise.resolve({ data: { ok: true, lead_id: 301, crm_message_id: 501 } });
    }
    return Promise.resolve({ data: { message: 'OK' } });
  });

  renderTelefonia('/telefonia?tab=calls');

  expect(await screen.findByText('Test CRM po rozmowie')).toBeInTheDocument();
  const testForm = screen.getByText('Test CRM po rozmowie').closest('form');
  const testPanel = within(testForm);
  await userEvent.selectOptions(testPanel.getByRole('combobox'), '7');
  await userEvent.type(testPanel.getByPlaceholderText('Numer testowy klienta'), '+48600111222');
  await userEvent.click(testPanel.getByRole('button', { name: 'Uruchom test' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/telefon/test-flow',
      expect.objectContaining({
        oddzial_id: 7,
        phone: '+48600111222',
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  expect(await screen.findByText('Otworz lead #301')).toBeInTheDocument();
});

test('starts Zadarma WebRTC phone from Arbor and stores auto-start preference', async () => {
  api.post.mockImplementation((url) => {
    if (url === '/telephony/zadarma/webrtc-key') {
      return Promise.resolve({ data: { key: 'webrtc-key-101', sip: '101' } });
    }
    return Promise.resolve({ data: { message: 'OK' } });
  });
  window.zadarmaWidgetFn = vi.fn();
  const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
    const result = HTMLBodyElement.prototype.appendChild.call(document.body, node);
    if (node.tagName === 'SCRIPT') {
      setTimeout(() => node.onload?.());
    }
    return result;
  });

  try {
    renderTelefonia('/telefonia?tab=zadarma');

    expect(await screen.findByText('Telefon w przegladarce WebRTC')).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('SIP / numer wewnetrzny PBX, np. 101'), '101');
    await userEvent.click(screen.getByLabelText('Uruchamiaj automatycznie w Arbor'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/telephony/zadarma/webrtc-key',
        { sip: '101' },
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
    await waitFor(() => {
      expect(window.zadarmaWidgetFn).toHaveBeenCalledWith(
        'webrtc-key-101',
        '101',
        'square',
        'pl',
        true,
        "{right:'16px',bottom:'16px'}"
      );
    });
    expect(localStorage.getItem('arbor_zadarma_webrtc_auto_v1')).toBe('1');
    expect(await screen.findByText('Status: aktywny SIP 101')).toBeInTheDocument();
  } finally {
    appendSpy.mockRestore();
  }
});
