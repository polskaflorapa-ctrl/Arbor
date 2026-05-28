import '../i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import AutoDispatch from './AutoDispatch';
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
  },
}));

const USER_JSON = JSON.stringify({
  rola: 'Kierownik',
  oddzial_id: 7,
  imie: 'Test',
  nazwisko: 'Manager',
});

const writeTextMock = vi.fn();

function TaskRouteProbe() {
  const location = useLocation();
  return <div>Sciezka zlecenia: {location.pathname}{location.search}</div>;
}

function renderAutoDispatch(initialEntry = '/auto-dispatch') {
  return render(
    <MemoryRouter
      initialEntries={[initialEntry]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/auto-dispatch" element={<AutoDispatch />} />
        <Route path="/zlecenia/:id" element={<TaskRouteProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.setItem('token', 'test-jwt');
  localStorage.setItem('user', USER_JSON);
  writeTextMock.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: writeTextMock },
    configurable: true,
  });
  api.get.mockReset();
  api.post.mockReset();
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('loads and renders AI dispatch advisor brief', async () => {
  api.get.mockResolvedValue({
    data: {
      source: 'ai',
      provider: 'huggingface',
      summary: 'Najpierw popraw dwa krytyczne braki.',
      metrics: {
        ready_for_dispatch: 3,
        tasks_total: 5,
        blocked: 2,
        warnings: 1,
        avg_quality: 72,
        total_value: 12500,
      },
      recommendations: [
        {
          priority: 'high',
          title: 'Napraw blokady przed solverem',
          rationale: 'Brakuje telefonu i terminu.',
          suggested_action: 'Uzupelnij dane w zleceniach.',
        },
      ],
      top_tasks: [
        {
          task_id: 42,
          task_numer: 'ZL/42',
          client: 'Jan Kowalski',
          status: 'Do_Zatwierdzenia',
          quality_score: 46,
          issues: [
            { key: 'client_phone', severity: 'critical', label: 'Brak telefonu', action: 'Dodaj numer telefonu klienta.' },
          ],
        },
      ],
    },
  });

  renderAutoDispatch('/auto-dispatch?date=2026-05-25');

  await userEvent.click(screen.getByRole('button', { name: 'AI Dyspozytor' }));

  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith(
      '/ai/dispatch-brief',
      expect.objectContaining({
        params: expect.objectContaining({ oddzial_id: 7 }),
        headers: expect.any(Object),
      })
    );
  });

  expect(await screen.findByText('Najpierw popraw dwa krytyczne braki.')).toBeInTheDocument();
  expect(screen.getByText('Napraw blokady przed solverem')).toBeInTheDocument();
  expect(screen.getByText('Odprawa AI')).toBeInTheDocument();
  expect(screen.getByText('Gotowa')).toBeInTheDocument();
  expect(screen.getByText('Blokady danych')).toBeInTheDocument();
  expect(screen.getByText('2 do naprawy')).toBeInTheDocument();
  expect(screen.getByText('Po naprawach')).toBeInTheDocument();
  expect(screen.getByText('Nastepna blokada')).toBeInTheDocument();
  expect(screen.getByText('ZL/42: Brak telefonu')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Napraw blokade' })).toBeInTheDocument();
  expect(screen.getByText('ZL/42')).toBeInTheDocument();
  expect(screen.getAllByText(/Jan Kowalski/).length).toBeGreaterThan(0);
  expect(screen.getByText('1 kryt.')).toBeInTheDocument();
  expect(screen.getByText('Otworz zlecenie')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Napraw w zleceniu ZL/42' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Kopiuj odprawe' }));
  await waitFor(() => {
    expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('AI Dyspozytor - odprawa dnia'));
  });
  expect(writeTextMock.mock.calls[0][0]).toContain('ZL/42 (1 kryt.) Jan Kowalski');
  expect(await screen.findByRole('button', { name: 'Skopiowano' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Napraw w zleceniu ZL/42' }));
  const routeProbe = await screen.findByText(/Sciezka zlecenia:/);
  expect(routeProbe).toHaveTextContent('/zlecenia/42?mode=edit');
  expect(routeProbe).toHaveTextContent('step=client');
  expect(routeProbe).toHaveTextContent('field=klient_telefon');
  expect(routeProbe).toHaveTextContent('issue=client_phone');
  expect(routeProbe).toHaveTextContent('returnTo=%2Fauto-dispatch%3Fdate%3D2026-05-25%26refresh%3Dadvisor%26repaired%3D1');
  expect(routeProbe).toHaveTextContent('returnLabel=AI+Dyspozytor');
}, 10000);

test('auto-refreshes advisor after returning from a repair', async () => {
  api.get.mockResolvedValue({
    data: {
      source: 'rules',
      summary: 'Po poprawce zostala jedna uwaga.',
      metrics: {
        ready_for_dispatch: 4,
        tasks_total: 5,
        blocked: 0,
        warnings: 1,
        avg_quality: 91,
        total_value: 18400,
      },
      recommendations: [
        { priority: 'medium', title: 'Sprawdz pinezke GPS', suggested_action: 'Otworz ostatnia uwage.' },
      ],
      top_tasks: [
        {
          task_id: 103,
          task_numer: 'TEST-103',
          client: 'Osiedle Lesne Tarasy',
          status: 'Do_Zatwierdzenia',
          quality_score: 84,
          issues: [
            { key: 'gps', severity: 'warning', label: 'Brak pinezki GPS', action: 'Dodaj pinezke lokalizacji.' },
          ],
        },
      ],
    },
  });

  renderAutoDispatch('/auto-dispatch?date=2026-05-25&refresh=advisor&repaired=1');

  expect(await screen.findByText('Po poprawce zostala jedna uwaga.')).toBeInTheDocument();
  expect(screen.getByText('Poprawka zapisana. Odprawa odswiezona.')).toBeInTheDocument();
  expect(screen.getByText('Nastepna uwaga')).toBeInTheDocument();
  expect(screen.getByText('TEST-103: Brak pinezki GPS')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Otworz uwage' })).toBeInTheDocument();
  expect(screen.getByText('TEST-103')).toBeInTheDocument();
  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith(
      '/ai/dispatch-brief',
      expect.objectContaining({
        params: expect.objectContaining({ date: '2026-05-25', oddzial_id: 7 }),
      })
    );
  });
}, 10000);

test('shows a solver-ready next action when the advisor has no blockers', async () => {
  api.get.mockResolvedValueOnce({
    data: {
      source: 'rules',
      summary: 'Wszystko gotowe do planowania.',
      metrics: {
        ready_for_dispatch: 5,
        tasks_total: 5,
        blocked: 0,
        warnings: 0,
        avg_quality: 98,
        total_value: 22000,
      },
      recommendations: [],
      top_tasks: [],
    },
  });
  api.post.mockResolvedValueOnce({
    data: {
      routes: [],
      stats: {
        coverage_pct: 100,
        tasks_assigned: 5,
        tasks_total: 5,
        teams_used: 2,
        tasks_unassigned: 0,
        solver_ms: 18,
      },
    },
  });

  renderAutoDispatch('/auto-dispatch?date=2026-05-25');

  await userEvent.click(screen.getByRole('button', { name: 'AI Dyspozytor' }));
  expect(await screen.findByText('Wszystko gotowe do planowania.')).toBeInTheDocument();
  expect(screen.getByText('Plan gotowy do solvera')).toBeInTheDocument();
  expect(screen.getByText('Brak blokad i uwag w odprawie dnia.')).toBeInTheDocument();
  expect(screen.getByText('Gotowy do generowania')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Generuj podglad planu' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/dispatch/plan',
      expect.objectContaining({ date: '2026-05-25', oddzial_id: 7 }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  expect(await screen.findByText('100%')).toBeInTheDocument();
  expect(screen.getByText('5 / 5 przypisane')).toBeInTheDocument();
  expect(screen.getByText('Zapisz, gdy plan pasuje')).toBeInTheDocument();
}, 10000);

test('shows absent team availability returned by dispatch preview', async () => {
  api.post.mockResolvedValueOnce({
    data: {
      routes: [],
      team_availability: {
        total: 3,
        available: 2,
        absent: [
          { team_id: 10, team_name: 'Brygada Alfa', note: 'Auto w serwisie' },
        ],
      },
      stats: {
        coverage_pct: 100,
        tasks_assigned: 4,
        tasks_total: 4,
        teams_used: 2,
        tasks_unassigned: 0,
        solver_ms: 21,
      },
    },
  });

  renderAutoDispatch('/auto-dispatch?date=2026-05-25');

  await userEvent.click(screen.getByRole('button', { name: /Podgląd planu/i }));

  expect(await screen.findByText('Nieobecne ekipy: 1')).toBeInTheDocument();
  expect(screen.getByText('2/3 dostepne')).toBeInTheDocument();
  expect(screen.getByText('Brygada Alfa')).toBeInTheDocument();
  expect(screen.getByText('Auto w serwisie')).toBeInTheDocument();
});

test('copies day and team handoff briefs from the generated plan', async () => {
  api.post
    .mockResolvedValueOnce({
      data: {
        routes: [
          {
            team_id: 10,
            team_name: 'Brygada Alfa',
            total_min: 150,
            distance_km: 22,
            end_time: '11:30',
            return_travel_min: 18,
            stops: [
              {
                task_id: 101,
                task_numer: 'ZL/101',
                client: 'Anna Nowak',
                client_phone: '+48500111222',
                adres: 'Lesna 1',
                eta: '08:00',
                okno_od: '08:00',
                okno_do: '10:00',
                travel_min: 15,
                service_min: 60,
                time_window_ok: true,
                lat: 52.1,
                lng: 21.1,
              },
              {
                task_id: 102,
                task_numer: 'ZL/102',
                client: 'Brak Kontaktu',
                client_phone: '',
                adres: 'Polna 2',
                eta: '10:20',
                travel_min: 25,
                service_min: 45,
                time_window_ok: false,
                lat: null,
                lng: null,
              },
            ],
          },
        ],
        unassigned: [],
        stats: {
          coverage_pct: 100,
          tasks_assigned: 2,
          tasks_total: 2,
          teams_used: 1,
          tasks_unassigned: 0,
          solver_ms: 21,
        },
      },
    })
    .mockResolvedValueOnce({
      data: {
        message: 'Odprawa wyslana do ekipy',
        notification_count: 2,
        status: {
          brief_id: 77,
          team_id: 10,
          team_name: 'Brygada Alfa',
          sent_to: 2,
          confirmed: 0,
          pending: 2,
          recipients: [
            { user_id: 21, name: 'Jan Brygadzista', status: 'Nowe' },
            { user_id: 22, name: 'Anna Pomocnik', status: 'Nowe' },
          ],
        },
      },
    })
    .mockResolvedValueOnce({
      data: {
        message: 'Przypomnienie wyslane',
        brief_id: 77,
        team_id: 10,
        team_name: 'Brygada Alfa',
        reminded: 2,
        recipients: [
          { user_id: 21, name: 'Jan Brygadzista', status: 'Nowe' },
          { user_id: 22, name: 'Anna Pomocnik', status: 'Nowe' },
        ],
      },
    });
  api.get.mockResolvedValue({
    data: {
      date: '2026-05-25',
      items: [],
      summary: { teams_sent: 0, sent_to: 0, confirmed: 0, pending: 0 },
    },
  });

  renderAutoDispatch('/auto-dispatch?date=2026-05-25');

  await userEvent.click(screen.getByRole('button', { name: /Podgl.d planu/i }));

  expect(await screen.findByText('Odprawy dla ekip')).toBeInTheDocument();
  expect(screen.getByText('Skopiuj plan dnia albo odprawe konkretnej ekipy.')).toBeInTheDocument();

  expect(screen.getByText(/Anna Nowak/)).toBeInTheDocument();
  expect(screen.getByText('Tel. +48500111222')).toBeInTheDocument();
  expect(screen.getByText('Brak telefonu')).toBeInTheDocument();
  expect(screen.getByText('Brak pinezki GPS')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Kopiuj plan dnia' }));
  await waitFor(() => {
    expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('Plan dnia - 2026-05-25'));
  });
  expect(writeTextMock.mock.calls.at(-1)[0]).toContain('Brygada Alfa');
  expect(writeTextMock.mock.calls.at(-1)[0]).toContain('ZL/102 - Brak Kontaktu');

  await userEvent.click(screen.getByRole('button', { name: 'Kopiuj odprawe ekipy Brygada Alfa' }));
  await waitFor(() => {
    expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('Odprawa ekipy - Brygada Alfa'));
  });
  expect(writeTextMock.mock.calls.at(-1)[0]).toContain('tel: brak telefonu');
  expect(writeTextMock.mock.calls.at(-1)[0]).toContain('uwagi: brak telefonu, brak pinezki gps, ryzyko okna czasowego');

  await userEvent.click(screen.getByRole('button', { name: 'Wyslij odprawy do ekip' }));
  await waitFor(() => {
    expect(api.post).toHaveBeenLastCalledWith(
      '/dispatch/route-brief/send',
      expect.objectContaining({
        date: '2026-05-25',
        oddzial_id: 7,
        team_id: 10,
        team_name: 'Brygada Alfa',
        task_ids: [101, 102],
        brief: expect.stringContaining('Odprawa ekipy - Brygada Alfa'),
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  expect(await screen.findByText('Wyslano odprawy: 1/1 ekip, 2 odbiorcow. Czekamy na potwierdzenia.')).toBeInTheDocument();
  expect(screen.getByText('Wyslano do 2 | czeka 2')).toBeInTheDocument();
  expect(screen.getByText('Odbiorcy odprawy')).toBeInTheDocument();
  expect(screen.getByText('Jan Brygadzista')).toBeInTheDocument();
  expect(screen.getByText('Anna Pomocnik')).toBeInTheDocument();
  expect(screen.getAllByText('Czeka')).toHaveLength(2);

  await userEvent.click(screen.getByRole('button', { name: 'Przypomnij oczekujacym Brygada Alfa' }));
  await waitFor(() => {
    expect(api.post).toHaveBeenLastCalledWith(
      '/dispatch/route-brief/77/remind',
      {},
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  expect(await screen.findByText('Przypomnienie wyslane: Brygada Alfa (2)')).toBeInTheDocument();
}, 10000);

test('loads persisted route brief confirmation statuses for a generated plan', async () => {
  api.post.mockResolvedValueOnce({
    data: {
      routes: [
        {
          team_id: 10,
          team_name: 'Brygada Alfa',
          total_min: 90,
          distance_km: 12,
          end_time: '09:30',
          return_travel_min: 12,
          stops: [
            {
              task_id: 101,
              task_numer: 'ZL/101',
              client: 'Anna Nowak',
              client_phone: '+48500111222',
              adres: 'Lesna 1',
              eta: '08:00',
              travel_min: 12,
              service_min: 60,
              time_window_ok: true,
              lat: 52.1,
              lng: 21.1,
            },
          ],
        },
      ],
      unassigned: [],
      stats: {
        coverage_pct: 100,
        tasks_assigned: 1,
        tasks_total: 1,
        teams_used: 1,
        tasks_unassigned: 0,
        solver_ms: 21,
      },
    },
  });
  api.get.mockResolvedValue({
    data: {
      date: '2026-05-25',
      items: [
        {
          brief_id: 77,
          team_id: 10,
          team_name: 'Brygada Alfa',
          sent_to: 2,
          confirmed: 1,
          pending: 1,
          recipients: [
            { user_id: 21, name: 'Jan Brygadzista', status: 'Przeczytane' },
            { user_id: 22, name: 'Anna Pomocnik', status: 'Nowe' },
          ],
        },
      ],
      summary: { teams_sent: 1, sent_to: 2, confirmed: 1, pending: 1 },
    },
  });

  renderAutoDispatch('/auto-dispatch?date=2026-05-25');

  await userEvent.click(screen.getByRole('button', { name: /Podgl.d planu/i }));

  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith(
      '/dispatch/route-brief/status',
      expect.objectContaining({
        params: expect.objectContaining({
          date: '2026-05-25',
          oddzial_id: 7,
          team_ids: '10',
        }),
        headers: expect.any(Object),
      })
    );
  });
  expect(await screen.findByText('Potwierdzone 1/2 | czeka 1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Odswiez odbior' })).toBeInTheDocument();
  expect(screen.getByText('Jan Brygadzista')).toBeInTheDocument();
  expect(screen.getByText('Anna Pomocnik')).toBeInTheDocument();
  expect(screen.getByText('Potwierdzono')).toBeInTheDocument();
  expect(screen.getByText('Czeka')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Przypomnij oczekujacym Brygada Alfa' })).toBeInTheDocument();
}, 10000);

test('reminds all teams with pending route brief confirmations', async () => {
  api.post
    .mockResolvedValueOnce({
      data: {
        routes: [
          {
            team_id: 10,
            team_name: 'Brygada Alfa',
            total_min: 90,
            distance_km: 12,
            end_time: '09:30',
            return_travel_min: 12,
            stops: [
              {
                task_id: 101,
                task_numer: 'ZL/101',
                client: 'Anna Nowak',
                adres: 'Lesna 1',
                eta: '08:00',
                travel_min: 12,
                service_min: 60,
              },
            ],
          },
          {
            team_id: 11,
            team_name: 'Brygada Beta',
            total_min: 80,
            distance_km: 9,
            end_time: '10:00',
            return_travel_min: 10,
            stops: [
              {
                task_id: 201,
                task_numer: 'ZL/201',
                client: 'Piotr Zielinski',
                adres: 'Polna 2',
                eta: '08:45',
                travel_min: 10,
                service_min: 55,
              },
            ],
          },
        ],
        unassigned: [],
        stats: {
          coverage_pct: 100,
          tasks_assigned: 2,
          tasks_total: 2,
          teams_used: 2,
          tasks_unassigned: 0,
          solver_ms: 19,
        },
      },
    })
    .mockResolvedValueOnce({
      data: { message: 'Przypomnienie wyslane', brief_id: 77, reminded: 2 },
    })
    .mockResolvedValueOnce({
      data: { message: 'Przypomnienie wyslane', brief_id: 88, reminded: 1 },
    });
  api.get.mockResolvedValue({
    data: {
      date: '2026-05-25',
      items: [
        {
          brief_id: 77,
          team_id: 10,
          team_name: 'Brygada Alfa',
          sent_to: 2,
          confirmed: 0,
          pending: 2,
          recipients: [
            { user_id: 21, name: 'Jan Brygadzista', status: 'Nowe' },
            { user_id: 22, name: 'Anna Pomocnik', status: 'Nowe' },
          ],
        },
        {
          brief_id: 88,
          team_id: 11,
          team_name: 'Brygada Beta',
          sent_to: 1,
          confirmed: 0,
          pending: 1,
          recipients: [
            { user_id: 23, name: 'Marek Monter', status: 'Nowe' },
          ],
        },
      ],
      summary: { teams_sent: 2, sent_to: 3, confirmed: 0, pending: 3 },
    },
  });

  renderAutoDispatch('/auto-dispatch?date=2026-05-25');

  await userEvent.click(screen.getByRole('button', { name: /Podgl.d planu/i }));

  const remindAllButton = await screen.findByRole('button', {
    name: 'Przypomnij wszystkim oczekujacym (3)',
  });
  expect(remindAllButton).toBeEnabled();

  await userEvent.click(remindAllButton);

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/dispatch/route-brief/77/remind',
      {},
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(api.post).toHaveBeenCalledWith(
      '/dispatch/route-brief/88/remind',
      {},
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  expect(await screen.findByText('Przypomnienia wyslane: 2/2 ekip, 3 odbiorcow.')).toBeInTheDocument();
}, 10000);

test('falls back when Clipboard API is blocked', async () => {
  writeTextMock.mockRejectedValueOnce(new Error('Clipboard blocked'));
  const originalExecCommand = document.execCommand;
  const execCommandMock = vi.fn().mockReturnValue(true);
  Object.defineProperty(document, 'execCommand', {
    value: execCommandMock,
    configurable: true,
  });

  api.get.mockResolvedValue({
    data: {
      source: 'rules',
      summary: 'Odprawa gotowa do wyslania.',
      metrics: {
        ready_for_dispatch: 1,
        tasks_total: 1,
        blocked: 0,
        warnings: 0,
        avg_quality: 96,
      },
      recommendations: [],
      top_tasks: [],
    },
  });

  try {
    renderAutoDispatch();

    await userEvent.click(screen.getByRole('button', { name: 'AI Dyspozytor' }));
    expect(await screen.findByText('Odprawa gotowa do wyslania.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Kopiuj odprawe' }));

    await waitFor(() => {
      expect(execCommandMock).toHaveBeenCalledWith('copy');
    });
    expect(await screen.findByRole('button', { name: 'Skopiowano' })).toBeInTheDocument();
    expect(screen.queryByText('Nie udalo sie skopiowac odprawy.')).not.toBeInTheDocument();
  } finally {
    Object.defineProperty(document, 'execCommand', {
      value: originalExecCommand,
      configurable: true,
    });
  }
});

test('shows a manual dispatch brief when automated copy is unavailable', async () => {
  writeTextMock.mockRejectedValueOnce(new Error('Clipboard blocked'));
  const originalExecCommand = document.execCommand;
  Object.defineProperty(document, 'execCommand', {
    value: vi.fn().mockReturnValue(false),
    configurable: true,
  });

  api.get.mockResolvedValue({
    data: {
      source: 'rules',
      summary: 'Schowek wymaga recznego kopiowania.',
      metrics: {
        ready_for_dispatch: 2,
        tasks_total: 2,
        blocked: 0,
        warnings: 1,
        avg_quality: 88,
      },
      recommendations: [
        { priority: 'medium', title: 'Sprawdz kontakt', suggested_action: 'Potwierdz numer telefonu.' },
      ],
      top_tasks: [
        {
          task_id: 51,
          task_numer: 'ZL/51',
          client: 'Manual Copy',
          issues: [{ severity: 'warning', label: 'Brak notatki' }],
        },
      ],
    },
  });

  try {
    renderAutoDispatch();

    await userEvent.click(screen.getByRole('button', { name: 'AI Dyspozytor' }));
    expect(await screen.findByText('Schowek wymaga recznego kopiowania.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Kopiuj odprawe' }));

    expect(await screen.findByText(/Automatyczne kopiowanie jest zablokowane/i)).toBeInTheDocument();
    const manualBrief = screen.getByRole('textbox', { name: 'Pakiet odprawy do recznego skopiowania' });
    expect(manualBrief.value).toContain('AI Dyspozytor - odprawa dnia');
    expect(manualBrief.value).toContain('ZL/51 (1 uwag) Manual Copy');
  } finally {
    Object.defineProperty(document, 'execCommand', {
      value: originalExecCommand,
      configurable: true,
    });
  }
});

test('filters risky advisor tasks by severity', async () => {
  api.get.mockResolvedValue({
    data: {
      source: 'rules',
      summary: 'Lista ryzyk gotowa.',
      metrics: {
        ready_for_dispatch: 2,
        tasks_total: 4,
        blocked: 1,
        warnings: 1,
        avg_quality: 74,
      },
      recommendations: [],
      top_tasks: [
        {
          task_id: 71,
          task_numer: 'ZL/KRYT',
          client: 'Krytyczny Klient',
          status: 'Wycena_Terenowa',
          quality_score: 41,
          issues: [
            { key: 'price', severity: 'critical', label: 'Brak ceny', action: 'Uzupelnij cene.' },
          ],
        },
        {
          task_id: 72,
          task_numer: 'ZL/UWAG',
          client: 'Uwaga Klient',
          status: 'Do_Zatwierdzenia',
          quality_score: 83,
          issues: [
            { key: 'gps', severity: 'warning', label: 'Brak pinezki GPS', action: 'Dodaj pinezke.' },
          ],
        },
      ],
    },
  });

  renderAutoDispatch();

  await userEvent.click(screen.getByRole('button', { name: 'AI Dyspozytor' }));
  expect(await screen.findByText('Lista ryzyk gotowa.')).toBeInTheDocument();

  expect(screen.getByRole('button', { name: 'Wszystkie 2' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Krytyczne 1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Uwagi 1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Brak ceny 1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Brak pinezki GPS 1' })).toBeInTheDocument();
  expect(screen.getByText('ZL/KRYT')).toBeInTheDocument();
  expect(screen.getByText('ZL/UWAG')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Brak ceny 1' }));
  expect(screen.getByText('ZL/KRYT')).toBeInTheDocument();
  expect(screen.queryByText('ZL/UWAG')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Wyczysc brak' }));
  expect(screen.getByText('ZL/KRYT')).toBeInTheDocument();
  expect(screen.getByText('ZL/UWAG')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Krytyczne 1' }));
  expect(screen.getByText('ZL/KRYT')).toBeInTheDocument();
  expect(screen.queryByText('ZL/UWAG')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Uwagi 1' }));
  expect(screen.queryByText('ZL/KRYT')).not.toBeInTheDocument();
  expect(screen.getByText('ZL/UWAG')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Wszystkie 2' }));
  expect(screen.getByText('ZL/KRYT')).toBeInTheDocument();
  expect(screen.getByText('ZL/UWAG')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Napraw w zleceniu ZL/UWAG' }));
  const routeProbe = await screen.findByText(/Sciezka zlecenia:/);
  expect(routeProbe).toHaveTextContent('/zlecenia/72?focus=officePlan');
  expect(routeProbe).toHaveTextContent('issue=gps');
});

test('checks AI advisor before saving and stops when blockers exist', async () => {
  api.get.mockResolvedValueOnce({
    data: {
      source: 'rules',
      date: '2026-05-25',
      metrics: {
        ready_for_dispatch: 2,
        tasks_total: 4,
        blocked: 2,
        warnings: 1,
        avg_quality: 64,
        total_value: 7000,
      },
      recommendations: [],
      top_tasks: [],
    },
  });

  renderAutoDispatch();

  await userEvent.click(screen.getByRole('button', { name: /Generuj i zapisz/i }));

  expect((await screen.findAllByText(/AI Dyspozytor zatrzymal zapis planu/i)).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Zapisz mimo blokad' })).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});

test('allows saving after the dispatcher preflight is bypassed', async () => {
  api.get.mockResolvedValueOnce({
    data: {
      source: 'rules',
      date: '2026-05-25',
      metrics: {
        ready_for_dispatch: 1,
        tasks_total: 3,
        blocked: 2,
        warnings: 0,
        avg_quality: 58,
        total_value: 3000,
      },
      recommendations: [],
      top_tasks: [],
    },
  });
  api.post.mockResolvedValueOnce({
    data: {
      id: 77,
      routes: [],
      stats: {
        coverage_pct: 0,
        tasks_assigned: 0,
        tasks_total: 0,
        teams_used: 0,
        tasks_unassigned: 0,
        solver_ms: 12,
      },
    },
  });

  renderAutoDispatch();

  await userEvent.click(screen.getByRole('button', { name: /Generuj i zapisz/i }));
  expect((await screen.findAllByText(/AI Dyspozytor zatrzymal zapis planu/i)).length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('button', { name: 'Zapisz mimo blokad' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/dispatch/plan/save',
      expect.objectContaining({ oddzial_id: 7 }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  expect(await screen.findByText(/Plan zapisany/)).toBeInTheDocument();
});

test('marks the dispatch progress as applied after applying a saved plan', async () => {
  api.get
    .mockResolvedValueOnce({
      data: {
        source: 'rules',
        date: '2026-05-25',
        metrics: {
          ready_for_dispatch: 3,
          tasks_total: 3,
          blocked: 0,
          warnings: 0,
          avg_quality: 97,
          total_value: 9000,
        },
        recommendations: [],
        top_tasks: [],
      },
    })
    .mockResolvedValueOnce({
      data: {
        source: 'rules',
        date: '2026-05-25',
        summary: 'Plan zastosowany, brak nowych blokad.',
        metrics: {
          ready_for_dispatch: 3,
          tasks_total: 3,
          blocked: 0,
          warnings: 0,
          avg_quality: 97,
          total_value: 9000,
        },
        recommendations: [],
        top_tasks: [],
      },
    });
  api.post
    .mockResolvedValueOnce({
      data: {
        id: 91,
        routes: [],
        stats: {
          coverage_pct: 100,
          tasks_assigned: 3,
          tasks_total: 3,
          teams_used: 1,
          tasks_unassigned: 0,
          solver_ms: 9,
        },
      },
    })
    .mockResolvedValueOnce({
      data: { message: 'Plan zastosowany!' },
    });

  renderAutoDispatch('/auto-dispatch?date=2026-05-25');

  await userEvent.click(screen.getByRole('button', { name: /Generuj i zapisz/i }));

  expect(await screen.findByText(/Plan zapisany/)).toBeInTheDocument();
  expect(screen.getByText('Gotowy do zastosowania')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /Zastosuj/i }));

  await waitFor(() => {
    expect(api.post).toHaveBeenLastCalledWith(
      '/dispatch/apply/91',
      {},
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  await waitFor(() => {
    const advisorCalls = api.get.mock.calls.filter(([url]) => url === '/ai/dispatch-brief');
    expect(advisorCalls.length).toBe(2);
  });
  expect(await screen.findByText('Plan zastosowany!')).toBeInTheDocument();
  expect(screen.getByText('Zastosowany')).toBeInTheDocument();
  expect(screen.getByText('Plan gotowy do wyslania ekipom.')).toBeInTheDocument();
}, 10000);
