import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import KalendarzZasobow from './KalendarzZasobow';
import api from '../api';

vi.mock('../components/Sidebar', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  },
}));

const USER_JSON = JSON.stringify({
  rola: 'Dyrektor',
  imie: 'Anna',
  nazwisko: 'Planer',
});

function mockCalendarApi() {
  api.get.mockImplementation((url) => {
    if (url === '/flota/sprzet') {
      return Promise.resolve({ data: [{ id: 11, nazwa: 'Rebak Forst', oddzial_id: 7 }] });
    }
    if (url === '/ekipy') {
      return Promise.resolve({ data: [{ id: 3, nazwa: 'Brygada Alfa', oddzial_id: 7, oddzial_nazwa: 'Wroclaw' }] });
    }
    if (url === '/oddzialy') {
      return Promise.resolve({ data: [{ id: 7, nazwa: 'Wroclaw' }] });
    }
    if (url === '/tasks/wszystkie') {
      return Promise.resolve({
        data: [
          {
            id: 42,
            status: 'Zaplanowane',
            ekipa_id: 3,
            oddzial_id: 7,
            klient_nazwa: 'Jan Kowalski',
            klient_telefon: '+48 500 100 200',
            adres: 'Lesna 12',
            miasto: 'Wroclaw',
            opis_pracy: 'Przycinka koron nad podjazdem',
            ryzyka: 'Linia energetyczna przy bramie',
            data_planowana: '2026-05-25T08:30:00',
            godzina_rozpoczecia: '08:30',
            czas_planowany_godziny: 3,
            wartosc_planowana: 2500,
            photos_count: 2,
            notatki: 'Klient zaakceptowal: tak\nWarunki rozliczenia: 2500 PLN netto',
          },
        ],
      });
    }
    if (String(url).startsWith('/flota/rezerwacje')) {
      return Promise.resolve({
        data: [
          {
            id: 77,
            task_id: 42,
            sprzet_id: 11,
            sprzet_nazwa: 'Rebak Forst',
            ekipa_id: 3,
            status: 'Zarezerwowane',
            data_od: '2026-05-25',
            data_do: '2026-05-25',
          },
        ],
      });
    }
    return Promise.resolve({ data: [] });
  });
}

function renderCalendar() {
  return render(
    <MemoryRouter
      initialEntries={['/kalendarz-zasobow?date=2026-05-25&modal=0']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/kalendarz-zasobow" element={<KalendarzZasobow />} />
        <Route path="/" element={<div>Login</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.setItem('token', 'test-jwt');
  localStorage.setItem('user', USER_JSON);
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.patch.mockReset();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('copies the dispatcher day brief with task, equipment, risk, and map context', async () => {
  mockCalendarApi();

  renderCalendar();

  await screen.findByRole('button', { name: /Kopiuj odprawe/i });
  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith('/tasks/wszystkie', expect.any(Object));
  });

  await userEvent.click(screen.getByRole('button', { name: /Kopiuj odprawe/i }));

  await waitFor(() => {
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });
  const copied = navigator.clipboard.writeText.mock.calls[0][0];
  expect(copied).toContain('ARBOR-OS | Odprawa dnia');
  expect(copied).toContain('Data: 2026-05-25');
  expect(copied).toContain('=== Brygada Alfa ===');
  expect(copied).toContain('#42 | 08:30-11:30 | Jan Kowalski');
  expect(copied).toContain('BHP / ryzyka: Linia energetyczna przy bramie');
  expect(copied).toContain('Sprzet: Rebak Forst');
  expect(copied).toContain('Akceptacja klienta: tak');
  expect(copied).toContain('Mapa: https://www.google.com/maps/search/?api=1&query=Lesna%2012%2C%20Wroclaw');
  expect(await screen.findByText('Odprawa dnia skopiowana.')).toBeInTheDocument();
});
