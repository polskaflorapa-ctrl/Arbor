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

function mockCalendarApi({ attendanceItems, tasks } = {}) {
  const taskRows = tasks ?? [
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
    {
      id: 43,
      status: 'Zaplanowane',
      ekipa_id: 4,
      oddzial_id: 7,
      klient_nazwa: 'Anna Nowak',
      adres: 'Polna 8',
      miasto: 'Wroclaw',
      opis_pracy: 'Frezowanie pnia po wycince',
      ryzyka: 'Waski wjazd',
      data_planowana: '2026-05-25T12:00:00',
      godzina_rozpoczecia: '12:00',
      czas_planowany_godziny: 2,
      wartosc_planowana: 900,
      photos_count: 1,
    },
  ];

  api.get.mockImplementation((url) => {
    if (url === '/flota/sprzet') {
      return Promise.resolve({ data: [{ id: 11, nazwa: 'Rebak Forst', oddzial_id: 7 }] });
    }
    if (url === '/ekipy') {
      return Promise.resolve({
        data: [
          { id: 3, nazwa: 'Brygada Alfa', oddzial_id: 7, oddzial_nazwa: 'Wroclaw' },
          { id: 4, nazwa: 'Brygada Beta', oddzial_id: 7, oddzial_nazwa: 'Wroclaw' },
        ],
      });
    }
    if (url === '/oddzialy') {
      return Promise.resolve({ data: [{ id: 7, nazwa: 'Wroclaw' }] });
    }
    if (url === '/tasks/wszystkie') {
      return Promise.resolve({
        data: taskRows,
      });
    }
    if (String(url).startsWith('/ekipy/attendance')) {
      return Promise.resolve({
        data: {
          date: '2026-05-25',
          items: attendanceItems ?? [
            { teamId: '3', teamName: 'Brygada Alfa', dateYmd: '2026-05-25', present: true },
            { teamId: '4', teamName: 'Brygada Beta', dateYmd: '2026-05-25', present: true },
          ],
          summary: { total: attendanceItems?.length ?? 2, confirmed: attendanceItems?.filter((item) => item.present !== false).length ?? 2, absent: attendanceItems?.filter((item) => item.present === false).length ?? 0 },
        },
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
        <Route path="/potwierdzenia-ekip" element={<div>Potwierdzenia ekip</div>} />
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

  await screen.findByRole('button', { name: /^Kopiuj odprawe$/i });
  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith('/tasks/wszystkie', expect.any(Object));
  });

  await userEvent.click(screen.getByRole('button', { name: /^Kopiuj odprawe$/i }));

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

test('copies a team-only day brief from the team header', async () => {
  mockCalendarApi();

  renderCalendar();

  await screen.findByRole('button', { name: 'Kopiuj odprawe ekipy Brygada Alfa' });
  await userEvent.click(screen.getByRole('button', { name: 'Kopiuj odprawe ekipy Brygada Alfa' }));

  await waitFor(() => {
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });
  const copied = navigator.clipboard.writeText.mock.calls[0][0];
  expect(copied).toContain('ARBOR-OS | Odprawa ekipy');
  expect(copied).toContain('=== Brygada Alfa ===');
  expect(copied).toContain('#42 | 08:30-11:30 | Jan Kowalski');
  expect(copied).not.toContain('Brygada Beta');
  expect(copied).not.toContain('Anna Nowak');
  expect(await screen.findByText('Odprawa ekipy Brygada Alfa skopiowana.')).toBeInTheDocument();
});

test('keeps an empty team brief tied to the selected team', async () => {
  mockCalendarApi({ tasks: [] });

  renderCalendar();

  await screen.findByRole('button', { name: 'Kopiuj odprawe ekipy Brygada Alfa' });
  await userEvent.click(screen.getByRole('button', { name: 'Kopiuj odprawe ekipy Brygada Alfa' }));

  await waitFor(() => {
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });
  const copied = navigator.clipboard.writeText.mock.calls[0][0];
  expect(copied).toContain('ARBOR-OS | Odprawa ekipy');
  expect(copied).toContain('=== Brygada Alfa ===');
  expect(copied).toContain('Brak zaplanowanych zlecen dla tej ekipy.');
  expect(await screen.findByText('Odprawa ekipy Brygada Alfa skopiowana.')).toBeInTheDocument();
});

test('marks absent teams in dispatch planning and copied briefs', async () => {
  mockCalendarApi({
    attendanceItems: [
      { teamId: '3', teamName: 'Brygada Alfa', dateYmd: '2026-05-25', present: false, note: 'Auto w serwisie' },
      { teamId: '4', teamName: 'Brygada Beta', dateYmd: '2026-05-25', present: true },
    ],
  });

  renderCalendar();

  expect(await screen.findByText('Nieobecna - Auto w serwisie')).toBeInTheDocument();
  expect(await screen.findByText('Nieobecna ekipa')).toBeInTheDocument();
  expect(screen.getByText(/1 zlecen zaplanowanych mimo braku gotowosci/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /^Kopiuj odprawe$/i }));

  await waitFor(() => {
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });
  const copied = navigator.clipboard.writeText.mock.calls[0][0];
  expect(copied).toContain('Nieobecne ekipy: 1');
  expect(copied).toContain('Nieobecne: Brygada Alfa - Auto w serwisie');
  expect(copied).toContain('Status ekipy: Nieobecna - Auto w serwisie');

  await userEvent.click(screen.getByText('Nieobecna ekipa'));
  expect(await screen.findByText('Potwierdzenia ekip')).toBeInTheDocument();
});
