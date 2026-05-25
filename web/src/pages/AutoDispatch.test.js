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

function renderAutoDispatch() {
  return render(
    <MemoryRouter
      initialEntries={['/auto-dispatch']}
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

  renderAutoDispatch();

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
  expect(screen.getByText('ZL/42')).toBeInTheDocument();
  expect(screen.getByText(/Jan Kowalski/)).toBeInTheDocument();
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
});

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
