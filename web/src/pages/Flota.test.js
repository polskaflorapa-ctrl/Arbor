import '../i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import Flota from './Flota';
import api from '../api';

vi.setConfig({ testTimeout: 15000 });

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

vi.mock('../components/CommandSidebar', () => ({
  __esModule: true,
  default: () => null,
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
            termin_odbioru: ymd(-1),
            priorytet: 'Pilny',
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
            termin_odbioru: ymd(-3),
            priorytet: 'Normalny',
            koszt: 900,
            czesci_kwota: 150,
            czesci_count: 2,
            opis_usterki: 'Alternator',
            wykonawca: 'Auto Serwis',
            status: 'Zakonczona',
          },
        ],
      });
    }
    if (url.startsWith('/flota/rezerwacje')) {
      return Promise.resolve({
        data: [
          {
            id: 501,
            sprzet_id: 11,
            ekipa_id: 3,
            data_od: ymd(0),
            data_do: ymd(1),
            status: 'Zarezerwowane',
            ekipa_nazwa: 'Brygada Alfa',
            protokoly: [],
            protokoly_count: 0,
            koszt_uszkodzen: 0,
            ostatni_stan: null,
          },
        ],
      });
    }
    if (url === '/flota/pojazdy/5/zdjecia') {
      return Promise.resolve({
        data: [{
          id: 301,
          url: 'https://example.test/uploads/mercedes.jpg',
          opis: 'Przod pojazdu',
        }],
      });
    }
    if (url === '/flota/pojazdy/5/dokumenty') {
      return Promise.resolve({
        data: [{
          id: 401,
          url: 'https://example.test/uploads/oc.pdf',
          kategoria: 'Polisa OC',
          nazwa_pliku: 'oc.pdf',
          wazny_do: ymd(12),
        }],
      });
    }
    if (url === '/flota/sprzet/11/zdjecia') return Promise.resolve({ data: [] });
    if (url === '/flota/sprzet/11/dokumenty') return Promise.resolve({ data: [] });
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

  await userEvent.click(await screen.findByRole('button', { name: /^Sprz.*\(\d+\)$/i }));
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
}, 15000);

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

test('opens and closes the vehicle asset detail card with media and documents', async () => {
  mockFlotaApi();

  renderFlota();

  await userEvent.click(await screen.findByRole('button', { name: /Pojazdy/i }));
  await userEvent.click(screen.getAllByRole('button', { name: /Mercedes Sprinter/i }).at(-1));

  expect(await screen.findByText('Karta zasobu')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /Mercedes Sprinter KR12345/i })).toBeInTheDocument();
  expect(screen.queryAllByText('Polisa OC').length).toBeGreaterThan(0);
  expect(screen.queryAllByAltText('Przod pojazdu').length).toBeGreaterThan(0);
  expect(screen.getByText('Alternator')).toBeInTheDocument();
  expect(screen.queryAllByText(/1\s*050 zl/i).length).toBeGreaterThan(0);
  expect(screen.getAllByTestId('location-search').at(-1)).toHaveTextContent('asset=pojazdy%3A5');

  expect(api.get).toHaveBeenCalledWith(
    '/flota/pojazdy/5/zdjecia',
    expect.objectContaining({ headers: expect.any(Object), dedupe: false })
  );
  expect(api.get).toHaveBeenCalledWith(
    '/flota/pojazdy/5/dokumenty',
    expect.objectContaining({ headers: expect.any(Object), dedupe: false })
  );

  await userEvent.click(screen.getByRole('button', { name: /Zamknij/i }));

  await waitFor(() => {
    expect(screen.queryByText('Karta zasobu')).not.toBeInTheDocument();
  });
  expect(screen.getAllByTestId('location-search').at(-1)).not.toHaveTextContent('asset=');
}, 15000);

test('saves equipment reservation protocol from asset detail card', async () => {
  mockFlotaApi();

  renderFlota('/flota?asset=sprzet%3A11');

  expect(await screen.findByText('Karta zasobu')).toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: /^Protokol$/i }));
  expect(await screen.findByText('Protokol wydania / zwrotu')).toBeInTheDocument();

  await userEvent.selectOptions(screen.getByDisplayValue('Wydanie'), 'zwrot');
  fireEvent.change(screen.getByPlaceholderText(/koszt strat/i), { target: { value: '123.45' } });
  fireEvent.change(screen.getByPlaceholderText(/osoba odbierajaca/i), { target: { value: 'Jan Operator' } });
  fireEvent.change(screen.getByPlaceholderText(/notatka:/i), { target: { value: 'Brak oslony lancucha' } });
  await userEvent.click(screen.getByRole('button', { name: /Zapisz protokol/i }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/flota/rezerwacje/501/protokoly',
      expect.any(FormData),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  const protocolCall = api.post.mock.calls.find(([url]) => url === '/flota/rezerwacje/501/protokoly');
  const form = protocolCall[1];
  expect(form.get('typ')).toBe('zwrot');
  expect(form.get('stan')).toBe('OK');
  expect(form.get('koszt_uszkodzen')).toBe('123.45');
  expect(form.get('osoba')).toBe('Jan Operator');
  expect(form.get('notatka')).toBe('Brak oslony lancucha');
}, 15000);

test('filters overdue open repairs', async () => {
  mockFlotaApi();

  renderFlota('/flota?tab=naprawy');

  expect(await screen.findByText('Noze do wymiany')).toBeInTheDocument();
  expect(screen.getByText('Alternator')).toBeInTheDocument();

  await userEvent.click(screen.getAllByRole('button', { name: /Po terminie/i }).at(-1));

  expect(screen.getByText('Noze do wymiany')).toBeInTheDocument();
  expect(screen.getByText('Pilny')).toBeInTheDocument();
  expect(screen.queryByText('Alternator')).not.toBeInTheDocument();
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

  await userEvent.click(await screen.findByRole('button', { name: /^Sprz.*\(\d+\)$/i }));
  await userEvent.click(screen.getByRole('button', { name: /\+ .*Dodaj/i }));
  await userEvent.click(screen.getByRole('button', { name: /Rebak w naprawie/i }));
  fireEvent.change(screen.getByLabelText(/Nazwa/i), { target: { value: 'Rebak awaryjny' } });
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
}, 15000);
}, 15000);
