import '../i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AutoDispatch from './AutoDispatch';
import api from '../api';

jest.mock('../components/Sidebar', () => ({
  __esModule: true,
  default: () => <aside data-testid="sidebar" />,
}));

jest.mock('../api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
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
  jest.clearAllMocks();
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
