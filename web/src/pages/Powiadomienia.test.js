import '../i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import Powiadomienia from './Powiadomienia';
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

vi.mock('../components/PageHeader', () => ({
  __esModule: true,
  default: ({ title, subtitle, actions }) => (
    <header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {actions}
    </header>
  ),
}));

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={['/powiadomienia']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/" element={<div>Login</div>} />
        <Route path="/powiadomienia" element={<Powiadomienia />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({
    id: 21,
    imie: 'Jan',
    nazwisko: 'Brygadzista',
    rola: 'Brygadzista',
    oddzial_id: 1,
  }));
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.delete.mockReset();
  api.get.mockImplementation(async (path) => {
    if (path === '/tasks/moje') return { data: [] };
    if (path === '/uzytkownicy') {
      return { data: [{ id: 7, imie: 'Anna', nazwisko: 'Kierownik', rola: 'Kierownik' }] };
    }
    if (path === '/notifications') {
      return {
        data: [
          {
            id: 99,
            typ: 'Odprawa ekipy',
            tresc: 'Odprawa ekipy - Brygada Alfa',
            status: 'Nowe',
            data_utworzenia: new Date().toISOString(),
            dispatch_route_brief_id: 77,
            dispatch_route_team_name: 'Brygada Alfa',
          },
          {
            id: 100,
            typ: 'info',
            tresc: 'Zwykla notatka',
            status: 'Nowe',
            data_utworzenia: new Date().toISOString(),
          },
        ],
      };
    }
    return { data: [] };
  });
  api.put.mockResolvedValue({ data: { updated: 1, skipped_route_briefs: 1 } });
  api.post.mockResolvedValue({ data: { message: 'Odprawa potwierdzona' } });
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('requires explicit route brief confirmation instead of mark-all read', async () => {
  renderPage();

  expect(await screen.findByText('Odprawy do potwierdzenia: 1')).toBeInTheDocument();
  expect(screen.getByText('Brygada Alfa')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Potwierdz odprawe' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /Oznacz wszystkie/i }));

  await waitFor(() => {
    expect(api.put).toHaveBeenCalledWith(
      '/notifications/odczytaj-wszystkie',
      {},
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  expect(await screen.findByText(/1 odpraw wymaga osobnego potwierdzenia/i)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Potwierdz odprawe' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/dispatch/route-brief/77/confirm',
      {},
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});
