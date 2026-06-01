import '../i18n';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import Flota from './Flota';
import api from '../api';

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
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

function ymd(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function mockFlotaApi() {
  api.get.mockImplementation((url) => {
    if (url === '/flota/pojazdy') {
      return Promise.resolve({
        data: [
          {
            id: 5,
            marka: 'Mercedes',
            model: 'Sprinter',
            nr_rejestracyjny: 'KR12345',
            status: 'Dostepny',
            oddzial_id: 1,
            oddzial_nazwa: 'Krakow',
            ekipa_nazwa: 'Brygada Alfa',
            data_przegladu: ymd(-4),
            data_ubezpieczenia: ymd(12),
            przebieg: 125000,
          },
        ],
      });
    }
    if (url === '/flota/sprzet') {
      return Promise.resolve({
        data: [
          {
            id: 11,
            nazwa: 'Rebak Forst',
            typ: 'Rebak',
            nr_seryjny: 'RF-11',
            status: 'W naprawie',
            oddzial_id: 1,
            oddzial_nazwa: 'Krakow',
            ekipa_id: 3,
            ekipa_nazwa: 'Brygada Alfa',
            data_przegladu: ymd(7),
            koszt_motogodziny: 35,
            przeglad_alert: 'soon',
            next_reservation_from: ymd(2),
            next_reservation_to: ymd(3),
            next_task_id: 42,
            next_task_client: 'Jan Kowalski',
            next_reservation_team: 'Brygada Alfa',
          },
        ],
      });
    }
    if (url === '/flota/naprawy') return Promise.resolve({ data: [] });
    if (url === '/oddzialy') return Promise.resolve({ data: [{ id: 1, nazwa: 'Krakow' }] });
    if (url === '/ekipy') return Promise.resolve({ data: [{ id: 3, nazwa: 'Brygada Alfa' }] });
    return Promise.resolve({ data: [] });
  });
}

function renderFlota() {
  return render(
    <MemoryRouter
      initialEntries={['/flota']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <LocationProbe />
      <Routes>
        <Route path="/" element={<div>Login</div>} />
        <Route path="/flota" element={<Flota />} />
        <Route
          path="/kalendarz-zasobow"
          element={(
            <div>
              <div>Kalendarz zasobow</div>
              <LocationProbe />
            </div>
          )}
        />
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
  api.put.mockReset();
  api.delete.mockReset();
  api.post.mockResolvedValue({ data: { id: 999 } });
  api.put.mockResolvedValue({ data: { id: 999 } });
  api.delete.mockResolvedValue({ data: { message: 'ok' } });
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('renders resource cards with inspection, insurance, reservation alerts, and calendar handoff', async () => {
  mockFlotaApi();

  renderFlota();

  expect(await screen.findByTestId('fleet-resource-cards-panel')).toBeInTheDocument();
  expect(screen.getByText('Rebak Forst')).toBeInTheDocument();
  expect(screen.getByTestId('fleet-alert-card-equipment-11-inspection')).toHaveTextContent(/Przeglad/i);
  expect(screen.getByTestId('fleet-alert-card-equipment-11-reservation')).toHaveTextContent(/Rezerwacja/i);
  expect(screen.getByTestId('fleet-resource-card-vehicle-5')).toBeInTheDocument();
  expect(screen.getAllByText('Mercedes Sprinter').length).toBeGreaterThan(0);
  expect(screen.getByTestId('fleet-alert-card-vehicle-5-insurance')).toHaveTextContent(/OC/i);

  await userEvent.click(within(screen.getByTestId('fleet-resource-card-equipment-11')).getByRole('button', { name: /Kalendarz zasobow/i }));

  await waitFor(() => {
    expect(screen.getByText('Kalendarz zasobow')).toBeInTheDocument();
  });
  const finalSearch = screen.getAllByTestId('location-search').at(-1);
  expect(finalSearch).toHaveTextContent('tab=equipment');
  expect(finalSearch).toHaveTextContent('equipment=11');
});

test('edits and deletes equipment from fleet cards CRUD flow', async () => {
  mockFlotaApi();
  window.confirm = vi.fn().mockReturnValue(true);

  renderFlota();

  await userEvent.click(await screen.findByRole('button', { name: /Sprz/i }));
  await userEvent.click(screen.getByRole('button', { name: 'Edytuj' }));

  expect(screen.getByText('Edytuj sprzet')).toBeInTheDocument();
  const nameInput = screen.getByDisplayValue('Rebak Forst');
  await userEvent.clear(nameInput);
  await userEvent.type(nameInput, 'Rebak Forst ST8');
  await userEvent.click(screen.getByRole('button', { name: 'Zapisz sprzet' }));

  await waitFor(() => {
    expect(api.put).toHaveBeenCalledWith(
      '/flota/sprzet/11',
      expect.objectContaining({
        nazwa: 'Rebak Forst ST8',
        status: 'W naprawie',
        ekipa_id: 3,
        oddzial_id: 1,
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  await userEvent.click(screen.getByRole('button', { name: 'Usun' }));

  await waitFor(() => {
    expect(api.delete).toHaveBeenCalledWith(
      '/flota/sprzet/11',
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});

test('adds broken chipper assigned to a team in one form submit', async () => {
  mockFlotaApi();

  renderFlota();

  await userEvent.click(await screen.findByRole('button', { name: /Sprz/i }));
  await userEvent.click(screen.getByRole('button', { name: /\+ .*Dodaj/i }));
  await userEvent.click(screen.getByRole('button', { name: /Rebak w naprawie/i }));
  await userEvent.type(screen.getByLabelText(/Nazwa/i), 'Rebak awaryjny');
  await userEvent.selectOptions(screen.getByLabelText(/Ekipa/i), '3');
  await userEvent.click(screen.getByRole('button', { name: /Dodaj/i }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/flota/sprzet',
      expect.objectContaining({
        nazwa: 'Rebak awaryjny',
        typ: 'Rebak',
        status: 'W naprawie',
        ekipa_id: '3',
        oddzial_id: 1,
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});
