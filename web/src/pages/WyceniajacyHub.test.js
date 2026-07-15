import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import api from '../api';
import WyceniajacyHub from './WyceniajacyHub';

vi.mock('../api', () => ({
  __esModule: true,
  default: { get: vi.fn() },
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}{location.search}</div>;
}

function renderHub() {
  return render(
    <MemoryRouter
      initialEntries={['/wyceniajacy-hub']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/" element={<div>Logowanie</div>} />
        <Route path="/wyceniajacy-hub" element={<WyceniajacyHub />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  api.get.mockReset();
  localStorage.setItem('token', 'estimator-token');
  localStorage.setItem('user', JSON.stringify({
    id: 7,
    imie: 'Ewa',
    nazwisko: 'Wycena',
    rola: 'Wyceniający',
    oddzial_id: 1,
  }));
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('renders the estimator office from real inspection data and keeps quotation navigation', async () => {
  api.get.mockResolvedValue({
    data: [
      {
        id: 11,
        klient_nazwa: 'Dom Seniora Parkowy',
        klient_telefon: '+48 500 666 555',
        typ_uslugi: 'Pielęgnacja koron',
        adres: 'al. Lipowa 8',
        miasto: 'Warszawa',
        data_planowana: new Date().toISOString(),
        status: 'Zaplanowane',
        wartosc_szacowana: 1000,
        wyceniajacy_id: 7,
        oddzial_id: 1,
      },
      {
        id: 12,
        klient_nazwa: 'Inny oddział',
        status: 'Zaplanowane',
        wyceniajacy_id: 8,
        oddzial_id: 2,
      },
      {
        id: 13,
        klient_nazwa: 'Hotel Park',
        status: 'Zakonczone',
        wycena_id: 92,
        wycena_status: 'Zaakceptowana',
        wartosc_szacowana: 4200,
        wyceniajacy_id: 7,
        oddzial_id: 1,
      },
    ],
  });

  renderHub();

  expect(await screen.findByRole('heading', { name: 'Dom Seniora Parkowy' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Zadzwoń' })).toHaveAttribute('href', 'tel:+48500666555');
  expect(screen.queryByText('Inny oddział')).not.toBeInTheDocument();
  expect(screen.getByText('Hotel Park')).toBeInTheDocument();
  expect(screen.getByText('1230 zł')).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/ogledziny', expect.objectContaining({
    headers: expect.objectContaining({ Authorization: 'Bearer estimator-token' }),
  }));

  fireEvent.click(screen.getByRole('button', { name: 'Wyślij wycenę' }));
  expect(await screen.findByTestId('location-probe')).toHaveTextContent('/wyceny-terenowe?id=11');
});

test('updates a quote locally and opens an existing field quotation', async () => {
  api.get.mockResolvedValue({
    data: [{
      id: 21,
      klient_nazwa: 'Wspólnota Zielona 12',
      klient_telefon: '500777888',
      notatki: 'Cięcia sanitarne',
      status: 'Zaplanowane',
      wartosc_szacowana: 2000,
      wycena_id: 321,
      wyceniajacy_id: 7,
      oddzial_id: 1,
    }],
  });

  renderHub();

  expect(await screen.findByRole('heading', { name: 'Wspólnota Zielona 12' })).toBeInTheDocument();
  const firstPrice = screen.getAllByLabelText('Cena')[0];
  fireEvent.change(firstPrice, { target: { value: '2000' } });
  await waitFor(() => expect(screen.getByText('3321 zł')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: 'Wyślij wycenę' }));
  expect(await screen.findByTestId('location-probe')).toHaveTextContent('/wyceny-terenowe/321');
});
