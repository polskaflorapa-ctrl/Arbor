import '../i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

function renderAutoDispatch() {
  return render(
    <MemoryRouter
      initialEntries={['/auto-dispatch']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/auto-dispatch" element={<AutoDispatch />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.setItem('token', 'test-jwt');
  localStorage.setItem('user', USER_JSON);
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
            { key: 'client_phone', label: 'Brak telefonu', action: 'Dodaj numer telefonu klienta.' },
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
