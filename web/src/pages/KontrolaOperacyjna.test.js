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
  api.put.mockReset();
  api.put.mockResolvedValue({ data: {} });
  api.get.mockImplementation((path, config = {}) => {
    if (path === '/oddzialy') return Promise.resolve({ data: [{ id: 7, nazwa: 'Oddzial Krakow' }] });
    if (path === '/automations/daily-digest/history') return Promise.resolve({ data: { items: [], total: 0 } });
    if (path === '/automations/daily-digest/settings') return Promise.resolve({ data: { settings: [] } });
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
          },
          alerts: [{ type: 'owner_acknowledgements', title: 'Potwierdzenia ownerow Kommo/SMS', count: 3, action: 'Sprawdz domkniecie.' }],
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

  expect(await screen.findByText('Rejestr potwierdzen ownerow')).toBeInTheDocument();
  expect((await screen.findAllByText('kommo_sync')).length).toBeGreaterThan(0);
  expect((await screen.findAllByText('ARB-KOMMO')).length).toBeGreaterThan(0);

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
  });
});
