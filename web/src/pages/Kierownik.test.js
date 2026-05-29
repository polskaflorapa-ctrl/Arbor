import '../i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import Kierownik from './Kierownik';
import api from '../api';

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock('../components/Sidebar', () => ({
  __esModule: true,
  default: () => <aside data-testid="sidebar" />,
}));

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={['/kierownik']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/" element={<div>Login</div>} />
        <Route path="/kierownik" element={<Kierownik />} />
        <Route path="/zlecenia/:id" element={<div>Szczegoly zlecenia</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const USER = {
  id: 7,
  imie: 'Anna',
  nazwisko: 'Kierownik',
  rola: 'Kierownik',
  oddzial_id: 1,
};

const TASKS = [
  {
    id: 42,
    numer: 'ARB-42',
    klient_nazwa: 'Osiedle Lesne',
    status: 'Do_Zatwierdzenia',
    oddzial_id: 1,
  },
];

const TEAMS = [
  { id: 11, nazwa: 'Brygada Alfa' },
];

const BRANCHES = [
  { id: 1, nazwa: 'Krakow' },
];

const COCKPIT = {
  summary: {
    open_tasks: 1,
    crews_active: 1,
  },
  crews: [],
  tasks_today: [],
};

const PLAN_REAL = {
  summary: {
    total: 0,
    delayed: 0,
  },
  tasks: [],
};

const ACTION_INSIGHTS = {
  summary: {
    total_events: 0,
    affected_tasks: 0,
    reminders: 0,
    avg_delta_minutes: 0,
  },
  reasons: [],
  issues: [],
  actions: [],
  recent: [],
};

function createRecommendationState(hidden = false) {
  const recommendation = {
    id: 'assign-crew-42',
    rank: 1,
    title: 'Przypisz ekipe do ARB-42',
    rationale: 'Zlecenie nie ma jeszcze wlasciciela wykonania.',
    suggested_action: 'Otworz zlecenie i przypisz brygade przed startem dnia.',
    impact_label: '1 zlecenie czeka na ekipe',
    priority: 'high',
    tone: 'danger',
    action_kind: 'open_task',
    primary_label: 'Otworz zlecenie',
    secondary_label: 'Podglad',
    target_path: '/zlecenia/42',
    task_ids: [42],
    task_preview: [
      {
        id: 42,
        numer: 'ARB-42',
        klient_nazwa: 'Osiedle Lesne',
        ekipa_nazwa: '',
        target_path: '/zlecenia/42',
      },
    ],
  };

  return {
    summary: {
      total: hidden ? 0 : 1,
      high: hidden ? 0 : 1,
      actionable: hidden ? 0 : 1,
      hidden_today: hidden ? 1 : 0,
    },
    recommendations: hidden ? [] : [recommendation],
    hidden_recommendations: hidden ? [recommendation] : [],
  };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify(USER));
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();

  let recommendationHidden = false;

  api.get.mockImplementation(async (path) => {
    if (path === '/tasks') return { data: TASKS };
    if (path === '/ekipy') return { data: TEAMS };
    if (path === '/oddzialy') return { data: BRANCHES };
    if (path === '/ops/kierownik-today') return { data: COCKPIT };
    if (path === '/ops/plan-vs-real') return { data: PLAN_REAL };
    if (path === '/ops/action-insights') return { data: ACTION_INSIGHTS };
    if (path === '/ops/action-recommendations') return { data: createRecommendationState(recommendationHidden) };
    return { data: null };
  });

  api.post.mockImplementation(async (path, body) => {
    if (path === '/ops/action-recommendations/assign-crew-42/apply') {
      return {
        data: {
          message: 'Decyzja rekomendacji zapisana',
          recommendation_id: 'assign-crew-42',
          action_kind: body?.action_kind,
          navigate_to: body?.target_path || '/zlecenia/42',
          feedback_event: { id: 501 },
        },
      };
    }
    if (path === '/ops/action-recommendations/assign-crew-42/feedback') {
      recommendationHidden = body?.decision === 'dismissed';
      return {
        data: {
          message: recommendationHidden ? 'Rekomendacja ukryta na dzis' : 'Decyzja zapisana',
          feedback: {
            recommendation_id: 'assign-crew-42',
            decision: body?.decision,
            date: body?.date,
          },
        },
      };
    }
    return { data: {} };
  });
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('hides and restores a recommendation from the manager cockpit', async () => {
  renderPage();

  expect(await screen.findByText('Sugerowane ruchy')).toBeInTheDocument();
  expect(screen.getByText('Przypisz ekipe do ARB-42')).toBeInTheDocument();
  expect(screen.getByText(/0 ukryte/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Pomin dzis' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/ops/action-recommendations/assign-crew-42/feedback',
      expect.objectContaining({
        decision: 'dismissed',
        oddzial_id: 1,
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  expect(await screen.findByText('Ukryte dzis')).toBeInTheDocument();
  expect(screen.getByText(/1 ukryte/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Przywroc' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Przywroc' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/ops/action-recommendations/assign-crew-42/feedback',
      expect.objectContaining({
        decision: 'accepted',
        oddzial_id: 1,
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  expect(await screen.findByText('Przypisz ekipe do ARB-42')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('Ukryte dzis')).not.toBeInTheDocument());
  expect(screen.getByText(/0 ukryte/)).toBeInTheDocument();
});

test('runs recommendation actions through the backend apply contract', async () => {
  renderPage();

  expect(await screen.findByText('Przypisz ekipe do ARB-42')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Otworz zlecenie' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/ops/action-recommendations/assign-crew-42/apply',
      expect.objectContaining({
        date: expect.any(String),
        oddzial_id: 1,
        action_kind: 'open_task',
        target_path: '/zlecenia/42',
        task_ids: [42],
        title: 'Przypisz ekipe do ARB-42',
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  expect(await screen.findByText('Szczegoly zlecenia')).toBeInTheDocument();
});
