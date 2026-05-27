import '../i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import Raporty from './Raporty';
import api from '../api';

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

vi.mock('../components/Sidebar', () => ({
  __esModule: true,
  default: () => <aside data-testid="sidebar" />,
}));

vi.mock('../components/PageHeader', () => ({
  __esModule: true,
  default: ({ title, subtitle }) => (
    <header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  ),
}));

vi.mock('../components/ModernDataRow', () => ({
  __esModule: true,
  default: ({ idValue, title, metrics = [], actions = null }) => (
    <section>
      <h3>{idValue}</h3>
      <p>{title}</p>
      {metrics.map((metric) => (
        <div key={`${idValue}-${metric.label}`}>{metric.label}: {metric.value}</div>
      ))}
      {actions}
    </section>
  ),
}));

vi.mock('../components/TaskStatusIcon', () => ({
  __esModule: true,
  default: () => <span data-testid="task-status-icon" />,
}));

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={['/raporty/analityka']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/" element={<div>Login</div>} />
        <Route path="/raporty/analityka" element={<Raporty />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({
    id: 1,
    imie: 'Anna',
    nazwisko: 'Dyrektor',
    rola: 'Dyrektor',
    oddzial_id: 1,
  }));

  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();

  api.get.mockImplementation(async (path) => {
    if (path === '/tasks/wszystkie') {
      return {
        data: [
          {
            id: 101,
            oddzial_id: 1,
            ekipa_id: 5,
            status: 'Zakonczone',
            data_planowana: '2026-05-15T10:00:00.000Z',
            wartosc_planowana: 1500,
            typ_uslugi: 'Wycinka',
          },
        ],
      };
    }
    if (path === '/oddzialy') {
      return {
        data: [{ id: 1, nazwa: 'Oddzial Warszawa' }],
      };
    }
    if (path === '/ekipy') {
      return {
        data: [{ id: 5, nazwa: 'Brygada Alfa', oddzial_id: 1 }],
      };
    }
    if (path === '/ogledziny' || path === '/wyceny' || path === '/telephony/calls' || path === '/telephony/callbacks') {
      return { data: [] };
    }
    if (String(path).startsWith('/oddzialy/cele?')) {
      return {
        data: [{
          oddzial_id: 1,
          rok: 2026,
          miesiac: 5,
          plan_zlecen: 3,
          plan_obrotu: 4000,
          plan_marzy: 1200,
        }],
      };
    }
    if (String(path).startsWith('/oddzialy/sprzedaz?')) {
      return {
        data: [{
          oddzial_id: 1,
          rok: 2026,
          miesiac: 5,
          calls_total: 10,
          calls_answered: 7,
          calls_missed: 3,
          leads_new: 4,
          meetings_booked: 2,
        }],
      };
    }
    return { data: [] };
  });

  api.post.mockResolvedValue({ data: { ok: true } });
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('saves branch monthly goals with numeric payload', async () => {
  renderPage();

  expect(await screen.findByRole('heading', { name: 'Raporty i analizy' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /oddzia/i }));

  await waitFor(() => {
    expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
  });
  const [planZlecenInput, planObrotuInput, planMarzyInput] = screen.getAllByRole('spinbutton');

  await userEvent.clear(planZlecenInput);
  await userEvent.type(planZlecenInput, '11');
  await userEvent.clear(planObrotuInput);
  await userEvent.type(planObrotuInput, '22000');
  await userEvent.clear(planMarzyInput);
  await userEvent.type(planMarzyInput, '27');
  await userEvent.click(screen.getByRole('button', { name: 'Zapisz cele' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/oddzialy/cele',
      expect.objectContaining({
        oddzial_id: 1,
        rok: expect.any(Number),
        miesiac: expect.any(Number),
        plan_zlecen: 11,
        plan_obrotu: 22000,
        plan_marzy: 27,
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});

test('saves branch sales inputs with numeric payload', async () => {
  renderPage();

  expect(await screen.findByRole('heading', { name: 'Raporty i analizy' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /sprzeda/i }));

  const saveButton = await screen.findByRole('button', { name: 'Zapisz dane sprzedaży' });
  const salesCard = saveButton.closest('div');
  const scoped = within(salesCard);
  const [callsTotalInput, callsAnsweredInput, callsMissedInput, leadsNewInput, meetingsBookedInput] = scoped.getAllByRole('spinbutton');

  await userEvent.clear(callsTotalInput);
  await userEvent.type(callsTotalInput, '18');
  await userEvent.clear(callsAnsweredInput);
  await userEvent.type(callsAnsweredInput, '13');
  await userEvent.clear(callsMissedInput);
  await userEvent.type(callsMissedInput, '5');
  await userEvent.clear(leadsNewInput);
  await userEvent.type(leadsNewInput, '9');
  await userEvent.clear(meetingsBookedInput);
  await userEvent.type(meetingsBookedInput, '4');
  await userEvent.click(saveButton);

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/oddzialy/sprzedaz',
      expect.objectContaining({
        oddzial_id: 1,
        rok: expect.any(Number),
        miesiac: expect.any(Number),
        calls_total: 18,
        calls_answered: 13,
        calls_missed: 5,
        leads_new: 9,
        meetings_booked: 4,
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});

test('saves call log with numeric branch and duration payload', async () => {
  renderPage();

  expect(await screen.findByRole('heading', { name: 'Raporty i analizy' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /sprzeda/i }));

  const saveButton = await screen.findByRole('button', { name: /Zapisz po/i });
  const callCard = saveButton.closest('div');
  const scoped = within(callCard);
  const selects = scoped.getAllByRole('combobox');
  const [oddzialSelect, callTypeSelect, statusSelect] = selects;
  const durationInput = scoped.getByRole('spinbutton');
  const phoneInput = scoped.getByPlaceholderText('Telefon (+48...)');
  const leadInput = scoped.getByPlaceholderText('Lead / klient');

  await userEvent.selectOptions(oddzialSelect, '1');
  await userEvent.type(phoneInput, '+48123123123');
  await userEvent.selectOptions(callTypeSelect, 'inbound');
  await userEvent.selectOptions(statusSelect, 'answered');
  await userEvent.type(durationInput, '125');
  await userEvent.type(leadInput, 'Jan Kowalski');
  await userEvent.click(saveButton);

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/telephony/calls',
      expect.objectContaining({
        oddzial_id: 1,
        phone: '+48123123123',
        call_type: 'inbound',
        status: 'answered',
        duration_sec: 125,
        lead_name: 'Jan Kowalski',
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});

test('saves callback queue entry with numeric branch payload', async () => {
  renderPage();

  expect(await screen.findByRole('heading', { name: 'Raporty i analizy' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /sprzeda/i }));

  const saveButton = await screen.findByRole('button', { name: /callback queue/i });
  const callbackCard = saveButton.closest('div');
  const scoped = within(callbackCard);
  const [oddzialSelect, prioritySelect] = scoped.getAllByRole('combobox');
  const phoneInput = scoped.getByPlaceholderText('Telefon (+48...)');
  const leadInput = scoped.getByPlaceholderText('Lead / klient');
  const dueAtInput = callbackCard.querySelector('input[type="datetime-local"]');

  await userEvent.selectOptions(oddzialSelect, '1');
  await userEvent.type(phoneInput, '+48999111222');
  await userEvent.type(leadInput, 'Maria Nowak');
  await userEvent.selectOptions(prioritySelect, 'high');
  fireEvent.change(dueAtInput, { target: { value: '2026-05-28T09:30' } });
  await userEvent.click(saveButton);

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith(
      '/telephony/callbacks',
      expect.objectContaining({
        oddzial_id: 1,
        phone: '+48999111222',
        lead_name: 'Maria Nowak',
        priority: 'high',
        due_at: '2026-05-28T09:30',
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});
