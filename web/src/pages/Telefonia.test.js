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
  api.post.mockResolvedValue({ data: { message: 'OK' } });
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
