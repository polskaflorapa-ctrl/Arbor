import '../i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import KontrolaOperacyjna from './KontrolaOperacyjna';
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
    put: vi.fn(),
  },
}));

function renderKontrola() {
  return render(
    <MemoryRouter
      initialEntries={['/kontrola-operacyjna']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/kontrola-operacyjna" element={<KontrolaOperacyjna />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.setItem('token', 'test-jwt-kontrola');
  localStorage.setItem('user', JSON.stringify({ id: 1, rola: 'Dyrektor', imie: 'Anna', nazwisko: 'Kontrola' }));
  api.get.mockReset();
  api.post.mockReset();
  api.post.mockResolvedValue({ data: { saved: 2, failed: 0 } });
  api.put.mockReset();
  api.put.mockResolvedValue({ data: {} });
  api.get.mockImplementation((path, config = {}) => {
    if (path === '/oddzialy') return Promise.resolve({ data: [{ id: 7, nazwa: 'Oddzial Krakow' }] });
    if (path === '/ops/owner-alerts/open') {
      return Promise.resolve({
        data: {
          date: config.params?.date || '2026-05-26',
          summary: { open_total: 2, kommo_sync: 1, sms_delivery: 1, p1: 1, p2: 1, overdue: 2 },
          items: [
            {
              id: 'kommo_sync:501',
              risk_id: 'kommo_sync:501',
              risk_type: 'kommo_sync',
              escalation_level: 'P1',
              sla_status: 'overdue',
              aging_minutes: 72,
              owner_label: 'Owner: integracje Kommo',
              numer: 'ARB-OPEN-KOMMO',
              klient_nazwa: 'Klient Kommo Open',
            },
            {
              id: 'sms_delivery:9',
              risk_id: 'sms_delivery:9',
              risk_type: 'sms_delivery',
              escalation_level: 'P2',
              sla_status: 'overdue',
              aging_minutes: 44,
              owner_label: 'Owner: kontakt z klientem',
              numer: 'ARB-OPEN-SMS',
              klient_nazwa: 'Klient SMS Open',
            },
          ],
        },
      });
    }
    if (path === '/automations/daily-digest/history') return Promise.resolve({ data: { items: [], total: 0 } });
    if (path === '/automations/daily-digest/settings') return Promise.resolve({ data: { settings: [] } });
    if (path === '/ops/owner-alerts/remediation-report') {
      return Promise.resolve({
        data: {
          date: config.params?.date || '2026-05-26',
          summary: {
            total: 3,
            retry_kommo: 2,
            resend_sms: 1,
            success: 2,
            failed: 0,
            limit_blocks: 1,
            blocked: 1,
          },
          items: [
            {
              id: 901,
              task_id: 77,
              numer: 'ARB-RETRY',
              klient_nazwa: 'Klient Retry',
              action_type: 'risk_owner_auto_remediate',
              risk_type: 'kommo_sync',
              risk_id: 'kommo_sync:501',
              remediation_action: 'retry_kommo',
              success: true,
              blocked: false,
              created_at: '2026-05-26T11:00:00.000Z',
            },
            {
              id: 902,
              task_id: 88,
              numer: 'ARB-LIMIT',
              klient_nazwa: 'Klient Limit',
              action_type: 'risk_owner_remediation_blocked',
              risk_type: 'kommo_sync',
              risk_id: 'kommo_sync:501',
              remediation_action: 'retry_kommo',
              success: false,
              blocked: true,
              block_reason: 'daily_limit',
              created_at: '2026-05-26T11:10:00.000Z',
            },
          ],
        },
      });
    }
    if (path === '/automations/daily-digest/preview') {
      return Promise.resolve({
        data: {
          date: '2026-05-26',
          summary: {
            high_alerts: 0,
            medium_alerts: 1,
            today_tasks: 2,
            margin_risks: 0,
            operational_decisions: 4,
            zadarma_actions: 1,
            owner_acknowledgements: 3,
            kommo_owner_acknowledgements: 1,
            sms_owner_acknowledgements: 2,
            owner_unresolved_after_remediation: 1,
            owner_unresolved_p1: 1,
            owner_unresolved_p2: 0,
          },
          alerts: [
            { type: 'owner_unresolved_after_remediation', title: 'Nierozwiazane P1/P2 po remediacji', count: 1, action: 'Eskaluj do dyrektora.' },
            { type: 'owner_acknowledgements', title: 'Potwierdzenia ownerow Kommo/SMS', count: 3, action: 'Sprawdz domkniecie.' },
          ],
        },
      });
    }
    if (path === '/ops/action-history') {
      const riskType = config.params?.risk_type || 'kommo_sync';
      return Promise.resolve({
        data: {
          total: 1,
          items: [{
            id: riskType === 'sms_delivery' ? 702 : 701,
            task_id: 77,
            numer: riskType === 'sms_delivery' ? 'ARB-SMS' : 'ARB-KOMMO',
            klient_nazwa: 'Klient Alert',
            oddzial_id: 7,
            oddzial_nazwa: 'Oddzial Krakow',
            actor_name: 'Test Dyspozytor',
            action_type: 'risk_acknowledge',
            action_label: 'Potwierdzenie ryzyka',
            risk_type: riskType,
            risk_id: `${riskType}:501`,
            outcome: `Potwierdzone: ${riskType}`,
            created_at: '2026-05-26T10:00:00.000Z',
          }],
          summary: {
            actions: [{ action_type: 'risk_acknowledge', label: 'Potwierdzenie ryzyka', count: 1 }],
            issues: [{ issue_key: riskType, label: riskType, count: 1 }],
          },
        },
      });
    }
    return Promise.reject(new Error(`unmocked GET ${path}`));
  });
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('shows owner acknowledgement register and filters Kommo/SMS acknowledgements', async () => {
  renderKontrola();

  expect(await screen.findByText('Niedomkniete alerty ownerow')).toBeInTheDocument();
  expect(await screen.findByText('ARB-OPEN-KOMMO')).toBeInTheDocument();
  expect(await screen.findByText('ARB-OPEN-SMS')).toBeInTheDocument();
  expect((await screen.findAllByText('P1')).length).toBeGreaterThan(0);
  expect((await screen.findAllByText('P2')).length).toBeGreaterThan(0);
  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith(
      '/ops/owner-alerts/open',
      expect.objectContaining({
        params: expect.objectContaining({
          date: expect.any(String),
        }),
      })
    );
  });

  expect(await screen.findByText('Rejestr potwierdzen ownerow')).toBeInTheDocument();
  expect(await screen.findByText('Skutecznosc remediacji ownerow')).toBeInTheDocument();
  expect(await screen.findByText('Retry Kommo')).toBeInTheDocument();
  expect(await screen.findByText('Ponowienia SMS')).toBeInTheDocument();
  expect(await screen.findByText('ARB-RETRY')).toBeInTheDocument();
  expect(await screen.findByText('daily_limit')).toBeInTheDocument();
  expect(await screen.findByText(/P1 \/ kommo_sync \/ overdue/)).toBeInTheDocument();
  expect((await screen.findAllByText('kommo_sync')).length).toBeGreaterThan(0);
  expect((await screen.findAllByText('ARB-KOMMO')).length).toBeGreaterThan(0);

  await userEvent.click(screen.getByRole('button', { name: 'Eskaluj widoczne' }));
  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/ops/owner-alerts/actions',
      expect.objectContaining({
        action: 'bulk_escalate',
        items: expect.arrayContaining([
          expect.objectContaining({ risk_id: 'kommo_sync:501', risk_type: 'kommo_sync' }),
          expect.objectContaining({ risk_id: 'sms_delivery:9', risk_type: 'sms_delivery' }),
        ]),
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  await userEvent.click(screen.getByRole('button', { name: 'Potwierdz widoczne' }));
  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/ops/owner-alerts/actions',
      expect.objectContaining({
        action: 'bulk_acknowledge',
        items: expect.arrayContaining([
          expect.objectContaining({ risk_id: 'kommo_sync:501', risk_type: 'kommo_sync' }),
          expect.objectContaining({ risk_id: 'sms_delivery:9', risk_type: 'sms_delivery' }),
        ]),
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  await userEvent.selectOptions(screen.getByLabelText('Filtr potwierdzen ownerow'), 'kommo_sync');

  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith(
      '/ops/action-history',
      expect.objectContaining({
        params: expect.objectContaining({
          action_type: 'risk_acknowledge',
          risk_type: 'kommo_sync',
        }),
      })
    );
  });
  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith(
      '/ops/owner-alerts/remediation-report',
      expect.objectContaining({
        params: expect.objectContaining({
          date: expect.any(String),
        }),
      })
    );
  });

  await userEvent.selectOptions(screen.getByLabelText('Filtr potwierdzen ownerow'), 'sms_delivery');

  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith(
      '/ops/action-history',
      expect.objectContaining({
        params: expect.objectContaining({
          action_type: 'risk_acknowledge',
          risk_type: 'sms_delivery',
        }),
      })
    );
  });

  expect((await screen.findAllByText('sms_delivery')).length).toBeGreaterThan(0);
  expect((await screen.findAllByText('ARB-SMS')).length).toBeGreaterThan(0);

  await userEvent.click(screen.getByRole('button', { name: /Digest/i }));

  await waitFor(() => {
    expect(screen.getAllByText('Potwierdzenia ownerow').length).toBeGreaterThan(0);
    expect(screen.getByText('Kommo 1 / SMS 2')).toBeInTheDocument();
    expect(screen.getAllByText(/Nierozwiazane P1\/P2 po remediacji/).length).toBeGreaterThan(0);
  });
}, 15000);
