import '../i18n';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import PotwierdzeniaEkip from './PotwierdzeniaEkip';
import api from '../api';

vi.mock('../components/Sidebar', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

const USER_JSON = JSON.stringify({
  rola: 'Dyrektor',
  imie: 'Anna',
  nazwisko: 'Planer',
});

function renderAttendance(initialPath = '/potwierdzenia-ekip?date=2026-05-25') {
  return render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/potwierdzenia-ekip" element={<PotwierdzeniaEkip />} />
        <Route path="/" element={<div>Login</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.setItem('token', 'test-jwt');
  localStorage.setItem('user', USER_JSON);
  api.get.mockReset();
  api.put.mockReset();
  api.get.mockImplementation((url) => {
    const path = String(url).split('?')[0];
    if (path === '/ekipy') {
      return Promise.resolve({
        data: [
          { id: 3, nazwa: 'Brygada Alfa' },
          { id: 4, nazwa: 'Brygada Beta' },
        ],
      });
    }
    if (path === '/ekipy/attendance') {
      return Promise.resolve({
        data: {
          date: '2026-05-25',
          items: [
            {
              id: '3_2026-05-25',
              dateYmd: '2026-05-25',
              teamId: '3',
              teamName: 'Brygada Alfa',
              present: false,
              note: 'Auto w serwisie',
            },
            {
              id: '4_2026-05-25',
              dateYmd: '2026-05-25',
              teamId: '4',
              teamName: 'Brygada Beta',
              present: true,
            },
          ],
        },
      });
    }
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('uses the date query from the calendar deep link', async () => {
  renderAttendance();

  expect(await screen.findByRole('heading', { name: 'Potwierdzenia ekip' })).toBeInTheDocument();
  expect(screen.getByDisplayValue('2026-05-25')).toBeInTheDocument();
  expect(await screen.findByText(/Brygada Alfa/)).toBeInTheDocument();
  expect(screen.getByDisplayValue('Auto w serwisie')).toBeInTheDocument();

  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith(
      '/ekipy/attendance?date=2026-05-25',
      expect.any(Object)
    );
  });
});
