import '../i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
            ekipa_id: 3,
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
    if (url === '/flota/naprawy') {
      return Promise.resolve({
        data: [
          {
            id: 91,
            typ_zasobu: 'Sprzet',
            zasob_id: 11,
            data_naprawy: ymd(0),
            koszt: 500,
            opis_usterki: 'Noze do wymiany',
            wykonawca: 'Serwis Forst',
            status: 'W toku',
          },
          {
            id: 92,
            typ_zasobu: 'Pojazd',
            zasob_id: 5,
            data_naprawy: ymd(-7),
            koszt: 900,
            opis_usterki: 'Alternator',
            wykonawca: 'Auto Serwis',
            status: 'Zakonczona',
          },
        ],
      });
    }
    if (url === '/oddzialy') return Promise.resolve({ data: [{ id: 1, nazwa: 'Krakow' }] });
    if (url === '/ekipy') return Promise.resolve({ data: [{ id: 3, nazwa: 'Brygada Alfa' }] });
    return Promise.resolve({ data: [] });
  });
}

function renderFlota(path = '/flota') {
  return render(
    <MemoryRouter
      initialEntries={[path]}
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
        <Route path="/zlecenia/:id" element={<LocationProbe />} />
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
  fireEvent.change(nameInput, { target: { value: 'Rebak Forst ST8' } });
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

test('closes an open repair from fleet repairs tab', async () => {
  mockFlotaApi();

  renderFlota();

  await userEvent.click(await screen.findByRole('button', { name: /^Naprawy$/i }));
  await userEvent.click(await screen.findByRole('button', { name: 'Zakoncz naprawe' }));

  await waitFor(() => {
    expect(api.put).toHaveBeenCalledWith(
      '/flota/naprawy/91',
      expect.objectContaining({
        id: 91,
        status: 'Zakonczona',
        opis_naprawy: 'Zakonczono naprawe',
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});

test('opens repairs tab from fleet deep link', async () => {
  mockFlotaApi();

  renderFlota('/flota?tab=naprawy');

  expect(await screen.findByText('Noze do wymiany')).toBeInTheDocument();
  expect(screen.getByText('Alternator')).toBeInTheDocument();
  expect(screen.getAllByText('Rebak Forst / Rebak (#11)').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Mercedes Sprinter KR12345 (#5)').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Zakoncz naprawe' })).toBeInTheDocument();
});

test('filters repairs tab from office plan resource deep link and returns to office plan', async () => {
  mockFlotaApi();

  renderFlota('/flota?tab=naprawy&team=3&kind=Sprzet&resource=11&returnTo=%2Fzlecenia%2F42%3Ffocus%3DofficePlan&returnLabel=Plan%20zlecenia%20%2342');

  expect(await screen.findByText('Naprawy zawężone')).toBeInTheDocument();
  expect(document.body.textContent).toContain('Brygada Alfa');
  expect(document.body.textContent).toContain('Rebak Forst');
  expect(screen.getByText('Noze do wymiany')).toBeInTheDocument();
  expect(screen.queryByText('Alternator')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Zakoncz i wroc do planu biura' }));
  await waitFor(() => {
    expect(api.put).toHaveBeenCalledWith(
      '/flota/naprawy/91',
      expect.objectContaining({ status: 'Zakonczona' }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  await waitFor(() => {
    const finalSearch = screen.getAllByTestId('location-search').at(-1);
    expect(finalSearch).toHaveTextContent('focus=officePlan');
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
