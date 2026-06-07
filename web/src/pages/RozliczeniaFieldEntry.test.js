import '../i18n';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import RozliczeniaFieldEntry from './RozliczeniaFieldEntry';
import api from '../api';

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
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
  rola: 'Dyrektor',
  oddzial_id: 1,
};

function renderPage(initialEntry = '/rozliczenia-polowe?task_id=103&tab=kalkulator') {
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify(USER));

  return render(
    <MemoryRouter
      initialEntries={[initialEntry]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/rozliczenia-polowe" element={<RozliczeniaFieldEntry />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RozliczeniaFieldEntry', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    api.get.mockImplementation((url) => {
      if (url === '/rozliczenia/zadanie/103') {
        return Promise.resolve({
          data: {
            task: {
              id: 103,
              klient_nazwa: 'Osiedle Lesne Tarasy',
              adres: 'Lesna 12',
              miasto: 'Krakow',
              ekipa_id: null,
              ekipa_nazwa: 'Brygada Alfa',
            },
            pomocnicy: [],
            rozliczenie: null,
          },
        });
      }
      return Promise.resolve({ data: [] });
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('opens the calculator tab and loads the task from query params', async () => {
    renderPage();

    expect(await screen.findAllByText(/Osiedle Lesne Tarasy/i)).toHaveLength(2);
    expect(screen.getByText(/Warto.* brutto/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Oblicz i zapisz/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        '/rozliczenia/zadanie/103',
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
  });
});
