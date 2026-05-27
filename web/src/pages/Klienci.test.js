import '../i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import Klienci from './Klienci';
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

const CLIENT_ROW = {
  id: 11,
  imie: 'Anna',
  nazwisko: 'Nowak',
  firma: 'Zielony Ogród',
  telefon: '+48500100200',
  miasto: 'Wroclaw',
  liczba_zlecen: 2,
  liczba_ogledzen: 1,
};

const CLIENT_DETAIL = {
  id: 11,
  imie: 'Anna',
  nazwisko: 'Nowak',
  firma: 'Zielony Ogród',
  telefon: '+48500100200',
  email: 'anna@ogrod.pl',
  adres: 'Lesna 12',
  miasto: 'Wroclaw',
  kod_pocztowy: '50-100',
  zrodlo: 'telefon',
  created_at: '2026-05-20T10:00:00.000Z',
  created_by_nazwa: 'Jan Operator',
  notatki: 'Klient premium',
  ogledziny: [],
  zlecenia: [
    {
      id: 101,
      status: 'Zaplanowane',
      typ_uslugi: 'Pielęgnacja',
      adres: 'Lesna 12',
      miasto: 'Wroclaw',
      data_planowana: '2026-05-26T08:00:00.000Z',
      ekipa_nazwa: 'Brygada Alfa',
      wartosc_planowana: 2500,
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={['/klienci']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/klienci" element={<Klienci />} />
        <Route path="/ogledziny" element={<div>Oględziny route</div>} />
        <Route path="/zlecenia/:id" element={<div>Zlecenie route</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({
    id: 7,
    imie: 'Anna',
    nazwisko: 'Kierownik',
    rola: 'Kierownik',
    oddzial_id: 1,
  }));
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.delete.mockReset();
  api.get.mockImplementation(async (path) => {
    if (path === '/klienci') return { data: [CLIENT_ROW] };
    if (path === '/klienci/11') return { data: CLIENT_DETAIL };
    return { data: null };
  });
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('shows the redesigned client passport after selecting a client from the list', async () => {
  renderPage();

  expect(await screen.findByText('Klienci')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Szukaj klienta...')).toBeInTheDocument();
  expect(screen.getByText('Anna Nowak')).toBeInTheDocument();

  fireEvent.click(screen.getByText('Anna Nowak'));

  expect(await screen.findByText('Paszport klienta')).toBeInTheDocument();
  expect(screen.getByText('Zielony Ogród')).toBeInTheDocument();
  expect(screen.getByText('Kontakt')).toBeInTheDocument();
  expect(screen.getByText('Informacje')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Zaplanuj ogl/i })).toBeInTheDocument();
  expect(screen.getByText(/Zlecenia \(1\)/)).toBeInTheDocument();
});
