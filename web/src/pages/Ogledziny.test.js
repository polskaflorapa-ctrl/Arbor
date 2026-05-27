import '../i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { vi } from 'vitest';
import Ogledziny from './Ogledziny';
import api from '../api';

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../components/Sidebar', () => ({
  __esModule: true,
  default: () => <aside data-testid="sidebar" />,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

function OgledzinyRouteHarness() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/ogledziny?klient=77')}>
        Open client handoff
      </button>
      <Ogledziny />
    </>
  );
}

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={['/ogledziny']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/ogledziny" element={<OgledzinyRouteHarness />} />
        <Route path="/nowe-zlecenie" element={<LocationProbe />} />
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
      nazwisko: 'Kierownik',
      rola: 'Kierownik',
      oddzial_id: 1,
    })
  );
  api.get.mockReset();
  api.put.mockReset();
  api.delete.mockReset();
  api.get.mockImplementation(async (path) => {
    if (path === '/ogledziny') return { data: [] };
    if (path === '/ekipy/live-locations') return { data: { items: [] } };
    return { data: null };
  });
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('reacts to klient query changes by redirecting into the new-order handoff route', async () => {
  renderPage();

  expect(screen.queryByTestId('location-probe')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Open client handoff' }));

  await waitFor(() => {
    expect(screen.getByTestId('location-probe')).toHaveTextContent(
      '/nowe-zlecenie?source=ogledziny&klientId=77'
    );
  });
});
