import '../i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { vi } from 'vitest';
import NoweZlecenie from './NoweZlecenie';
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

function mockBootstrapData() {
  api.get.mockImplementation(async (path) => {
    if (path === '/oddzialy') {
      return { data: [{ id: 1, nazwa: 'Wroclaw', miasto: 'Wroclaw' }] };
    }
    if (path === '/ekipy') {
      return { data: [{ id: 3, nazwa: 'Brygada Alfa', oddzial_id: 1 }] };
    }
    if (path === '/uzytkownicy') {
      return {
        data: [
          { id: 7, imie: 'Anna', nazwisko: 'Kierownik', rola: 'Kierownik', oddzial_id: 1 },
          { id: 9, imie: 'Jan', nazwisko: 'Specjalista', rola: 'Specjalista', oddzial_id: 1 },
        ],
      };
    }
    if (path === '/auth/me') {
      return {
        data: { id: 7, imie: 'Anna', nazwisko: 'Kierownik', rola: 'Kierownik', oddzial_id: 1 },
      };
    }
    return { data: null };
  });
}

function renderPage(initialEntry = '/nowe-zlecenie?source=wycena-kalendarz') {
  return render(
    <MemoryRouter
      initialEntries={[initialEntry]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <NoweZlecenie />
    </MemoryRouter>
  );
}

function NoweZlecenieRouteHarness() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/nowe-zlecenie')}>
        Reset route
      </button>
      <NoweZlecenie />
    </>
  );
}

function renderPageHarness(initialEntry = '/nowe-zlecenie?source=wycena-kalendarz') {
  return render(
    <MemoryRouter
      initialEntries={[initialEntry]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/nowe-zlecenie" element={<NoweZlecenieRouteHarness />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'test-token');
  localStorage.setItem(
    'user',
    JSON.stringify({
      id: 7,
      imie: 'Anna',
      rola: 'Kierownik',
      oddzial_id: 1,
    })
  );
  api.get.mockReset();
  api.post.mockReset();
  mockBootstrapData();
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('shows the source badge and seeds internal notes for quotation calendar entries', async () => {
  renderPage();

  expect((await screen.findAllByText('Zrodlo: kalendarz wycen')).at(0)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/zlecenia, instrukcje/i)).toHaveValue(
    'Zrodlo: kalendarz wycen'
  );
  expect(screen.getByRole('button', { name: /zlecenie/i })).toBeDisabled();
});

test('clears the source-seeded note after navigating to bare route when user did not edit it', async () => {
  renderPageHarness();

  expect((await screen.findAllByText('Zrodlo: kalendarz wycen')).at(0)).toBeInTheDocument();
  expect(screen.getByLabelText('Notatki wewnetrzne')).toHaveValue('Zrodlo: kalendarz wycen');

  fireEvent.click(screen.getByRole('button', { name: 'Reset route' }));

  await waitFor(() => {
    expect(screen.queryByText('Zrodlo: kalendarz wycen')).not.toBeInTheDocument();
  });
  expect(screen.getByLabelText('Notatki wewnetrzne')).toHaveValue('');
});
