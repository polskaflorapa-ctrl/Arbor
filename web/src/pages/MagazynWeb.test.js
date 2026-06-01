import '../i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import MagazynWeb from './MagazynWeb';
import api from '../api';

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../components/Sidebar', () => ({
  __esModule: true,
  default: () => <aside data-testid="sidebar" />,
}));

const USER = {
  id: 7,
  imie: 'Anna',
  nazwisko: 'Kierownik',
  rola: 'Kierownik',
  oddzial_id: 1,
};

function mockWarehouseApi() {
  api.get.mockResolvedValue({
    data: [
      {
        id: 3,
        nazwa: 'Paliwo mieszanka',
        jednostka: 'l',
        sku: 'PAL-2T',
        min_stan: 5,
        koszt_jednostkowy: '12.50',
        stan: '8.0000',
        oddzial_nazwa: 'Krakow',
        stan_alert: 'ok',
      },
      {
        id: 4,
        nazwa: 'Olej do pilarek',
        jednostka: 'l',
        sku: 'OLEJ',
        min_stan: 4,
        koszt_jednostkowy: '18.00',
        stan: '2.0000',
        oddzial_nazwa: 'Krakow',
        stan_alert: 'low',
      },
    ],
  });
}

function renderWarehouse() {
  return render(
    <MemoryRouter initialEntries={['/magazyn']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<div>Login</div>} />
        <Route path="/magazyn" element={<MagazynWeb />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'test-jwt');
  localStorage.setItem('user', JSON.stringify(USER));
  api.get.mockReset();
  api.post.mockReset();
  api.post.mockResolvedValue({ data: { id: 99 } });
  mockWarehouseApi();
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('renders material inventory and saves material receipt and task issue', async () => {
  renderWarehouse();

  expect(await screen.findByText('Magazyn materialow')).toBeInTheDocument();
  expect(screen.getByText('Paliwo mieszanka')).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Rozchod na zlecenie' })).toBeInTheDocument();
  expect(screen.getByText(/Niski stan/i)).toBeInTheDocument();
  expect(screen.getByText(/Kartoteki: 2/i)).toBeInTheDocument();

  await userEvent.type(screen.getByRole('textbox', { name: /Nazwa/i }), 'Kliny sekcyjne');
  await userEvent.type(screen.getByRole('textbox', { name: /SKU/i }), 'KLIN');
  await userEvent.clear(screen.getByRole('textbox', { name: /Jednostka/i }));
  await userEvent.type(screen.getByRole('textbox', { name: /Jednostka/i }), 'szt');
  await userEvent.type(screen.getByRole('spinbutton', { name: /Min\. stan/i }), '10');
  await userEvent.type(screen.getByRole('spinbutton', { name: /Koszt jedn\./i }), '7');
  await userEvent.click(screen.getByRole('button', { name: 'Dodaj material' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/magazyn/materialy',
      expect.objectContaining({
        nazwa: 'Kliny sekcyjne',
        jednostka: 'szt',
        sku: 'KLIN',
        min_stan: 10,
        koszt_jednostkowy: 7,
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  await userEvent.type(screen.getByRole('spinbutton', { name: /Ilosc/i }), '2');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /Typ ruchu/i }), 'rozchod');
  await userEvent.type(screen.getByRole('spinbutton', { name: /Zlecenie ID/i }), '77');
  await userEvent.click(screen.getByRole('button', { name: 'Zapisz ruch' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/magazyn/ruchy',
      expect.objectContaining({
        material_id: 3,
        typ: 'rozchod',
        ilosc: 2,
        task_id: 77,
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
}, 15000);
