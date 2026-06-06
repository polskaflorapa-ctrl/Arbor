import '../i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import Ekipy from './Ekipy';
import api from '../api';

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
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

function mockEkipyApi() {
  api.get.mockImplementation((url) => {
    if (url === '/ekipy') {
      return Promise.resolve({
        data: [{
          id: 3,
          nazwa: 'Brygada Alfa',
          oddzial_id: 1,
          oddzial_nazwa: 'Krakow',
          liczba_czlonkow: 1,
        }],
      });
    }
    if (url === '/ekipy/3') {
      return Promise.resolve({
        data: {
          id: 3,
          nazwa: 'Brygada Alfa',
          oddzial_id: 1,
          oddzial_nazwa: 'Krakow',
          czlonkowie: [],
        },
      });
    }
    if (url === '/uzytkownicy') return Promise.resolve({ data: [] });
    if (url === '/oddzialy') return Promise.resolve({ data: [{ id: 1, nazwa: 'Krakow' }] });
    if (url === '/flota/pojazdy') {
      return Promise.resolve({
        data: [
          { id: 5, marka: 'Mercedes', model: 'Sprinter', nr_rejestracyjny: 'KR12345', status: 'W naprawie', oddzial_id: 1, ekipa_id: 3 },
          { id: 6, marka: 'Ford', model: 'Transit', nr_rejestracyjny: 'KR54321', status: 'Dostepny', oddzial_id: 1, ekipa_id: null },
        ],
      });
    }
    if (url === '/flota/sprzet') {
      return Promise.resolve({
        data: [
          { id: 11, nazwa: 'Rebak Forst', typ: 'Rebak', status: 'Dostepny', oddzial_id: 1, ekipa_id: 3 },
          { id: 12, nazwa: 'Pilarka Stihl', typ: 'Pilarka', status: 'Dostepny', oddzial_id: 1, ekipa_id: null },
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
            data_naprawy: '2026-06-01',
            opis_usterki: 'Noze do wymiany',
            status: 'W toku',
          },
        ],
      });
    }
    return Promise.resolve({ data: [] });
  });
}

function renderEkipy() {
  return render(
    <MemoryRouter initialEntries={['/ekipy']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<div>Login</div>} />
        <Route path="/ekipy" element={<Ekipy />} />
        <Route path="/flota" element={<div>Flota</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'test-jwt');
  localStorage.setItem('user', JSON.stringify(USER));
  api.get.mockReset();
  api.put.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  api.put.mockResolvedValue({ data: { message: 'ok' } });
  api.post.mockResolvedValue({ data: { id: 501 } });
});

test('reports equipment repair from team asset list', async () => {
  mockEkipyApi();

  const { container } = renderEkipy();

  await waitFor(() => expect(container.querySelector('.ekipy-team-card')).toBeTruthy());
  await userEvent.click(container.querySelector('.ekipy-team-card'));
  expect(await screen.findByText('Sprzet i auta ekipy')).toBeInTheDocument();
  const repairButtons = await screen.findAllByRole('button', { name: 'Zglos naprawe' });
  await userEvent.click(repairButtons[1]);
  await userEvent.type(screen.getByPlaceholderText('Opis usterki dla biura/serwisu'), 'Nie odpala po zalaniu');
  await userEvent.click(screen.getByRole('button', { name: 'Zapisz naprawe' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/flota/naprawy',
      expect.objectContaining({
        typ_zasobu: 'Sprzet',
        zasob_id: 11,
        opis_usterki: 'Nie odpala po zalaniu',
        status: 'W toku',
        oddzial_id: 1,
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});

test('closes equipment repair from team asset history', async () => {
  mockEkipyApi();

  const { container } = renderEkipy();

  await waitFor(() => expect(container.querySelector('.ekipy-team-card')).toBeTruthy());
  await userEvent.click(container.querySelector('.ekipy-team-card'));

  expect(await screen.findByText(/2026-06-01 - Noze do wymiany/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Zakoncz' }));

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

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('shows and updates team vehicles and equipment in team detail', async () => {
  mockEkipyApi();

  const { container } = renderEkipy();

  expect(await screen.findByText(/1 zasob w naprawie/i)).toBeInTheDocument();
  await waitFor(() => expect(container.querySelector('.ekipy-team-card')).toBeTruthy());
  await userEvent.click(container.querySelector('.ekipy-team-card'));

  expect(await screen.findByText('Sprzet i auta ekipy')).toBeInTheDocument();
  expect(screen.getAllByText(/Mercedes Sprinter KR12345/i).length).toBeGreaterThan(0);
  expect(screen.getByText('Mercedes Sprinter')).toBeInTheDocument();
  expect(screen.getByText('Rebak Forst')).toBeInTheDocument();
  expect(screen.getByText(/2026-06-01 - Noze do wymiany/i)).toBeInTheDocument();

  await userEvent.click(screen.getAllByRole('button', { name: 'W naprawie' })[1]);

  await waitFor(() => {
    expect(api.put).toHaveBeenCalledWith(
      '/flota/sprzet/11',
      expect.objectContaining({
        nazwa: 'Rebak Forst',
        typ: 'Rebak',
        status: 'W naprawie',
        ekipa_id: 3,
        oddzial_id: 1,
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});
