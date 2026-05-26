import '../i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import Zlecenia from './Zlecenia';
import api from '../api';

vi.mock('../components/Sidebar', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../components/TelemetryStatus', () => ({
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
    delete: vi.fn(),
  },
}));

const USER_JSON = JSON.stringify({
  id: 9001,
  rola: 'Dyrektor',
  imie: 'Anna',
  nazwisko: 'Planer',
});

const scrollIntoViewMock = vi.fn();

const TASK = {
  id: 42,
  status: 'Do_Zatwierdzenia',
  klient_nazwa: 'Jan Kowalski',
  klient_telefon: '',
  klient_email: '',
  adres: 'Lesna 12',
  miasto: 'Wroclaw',
  typ_uslugi: 'Pielegnacja',
  oddzial_id: 7,
  data_planowana: '',
  godzina_rozpoczecia: '',
  wartosc_planowana: 2500,
  czas_planowany_godziny: 3,
  opis_pracy: 'Przycinka koron nad podjazdem',
  ekipa_id: '',
};

const SLOW_FORM_RENDER = { timeout: 10000 };

function mockZleceniaApi() {
  api.get.mockImplementation((url) => {
    if (url === '/tasks/wszystkie') return Promise.resolve({ data: [TASK] });
    if (url === '/tasks/42') return Promise.resolve({ data: TASK });
    if (url === '/ekipy') return Promise.resolve({ data: [{ id: 3, nazwa: 'Brygada Alfa', oddzial_id: 7 }] });
    if (url === '/uzytkownicy') return Promise.resolve({ data: [] });
    if (url === '/oddzialy') return Promise.resolve({ data: [{ id: 7, nazwa: 'Wroclaw' }] });
    if (url === '/flota/sprzet') return Promise.resolve({ data: [] });
    if (url === '/tasks/client-contacts') return Promise.resolve({ data: null });
    if (url === '/tasks/closure-events') return Promise.resolve({ data: null });
    if (String(url).startsWith('/tasks/42/')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
}

function renderRoute(path) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/zlecenia/:id" element={<Zlecenia />} />
        <Route path="/auto-dispatch" element={<div>Powrot do AI Dyspozytora</div>} />
        <Route path="/" element={<div>Login</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'test-jwt');
  localStorage.setItem('user', USER_JSON);
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoViewMock,
  });
  scrollIntoViewMock.mockClear();
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.patch.mockReset();
  api.delete.mockReset();
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('opens routed repair links in edit mode and focuses the requested field', async () => {
  mockZleceniaApi();

  renderRoute('/zlecenia/42?mode=edit&step=client&field=klient_telefon&repairLabel=Brak%20telefonu&repairDetail=Dodaj%20numer%20telefonu%20klienta.');

  expect(await screen.findByText('Tryb naprawy', {}, SLOW_FORM_RENDER)).toBeInTheDocument();
  expect(screen.getByText('Brak telefonu')).toBeInTheDocument();
  expect(screen.getByText('Dodaj numer telefonu klienta.')).toBeInTheDocument();

  const phoneInput = screen.getByPlaceholderText('+48 000 000 000');
  expect(phoneInput).toHaveValue('');
  await waitFor(() => expect(document.activeElement).toBe(phoneInput));
}, 15000);

test('returns to dispatcher after saving a routed repair link', async () => {
  mockZleceniaApi();
  api.put.mockResolvedValue({
    data: {
      ...TASK,
      klient_telefon: '+48 600 700 800',
    },
  });

  renderRoute('/zlecenia/42?mode=edit&step=client&field=klient_telefon&repairLabel=Brak%20telefonu&repairDetail=Dodaj%20numer%20telefonu%20klienta.&returnTo=%2Fauto-dispatch&returnLabel=AI%20Dyspozytor');

  expect(await screen.findByText('Tryb naprawy', {}, SLOW_FORM_RENDER)).toBeInTheDocument();
  const returnButton = screen.getByRole('button', {
    name: (name) => name.includes('Zapisz') && name.includes('AI Dyspozytor'),
  });
  expect(returnButton).toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText('+48 000 000 000'), {
    target: { value: '+48 600 700 800' },
  });
  fireEvent.click(returnButton);

  await waitFor(() => {
    expect(api.put).toHaveBeenCalledWith(
      '/tasks/42',
      expect.objectContaining({ klient_telefon: '+48 600 700 800' }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
  expect(await screen.findByText('Powrot do AI Dyspozytora', {}, SLOW_FORM_RENDER)).toBeInTheDocument();
}, 15000);

test('opens routed office planning focus links in task details', async () => {
  mockZleceniaApi();

  renderRoute('/zlecenia/42?focus=officePlan');

  expect(await screen.findByText('Do zaplanowania dla ekipy', {}, SLOW_FORM_RENDER)).toBeInTheDocument();
  const officePlanSection = document.querySelector('[data-detail-section="officePlan"]');
  expect(officePlanSection).toBeTruthy();

  await waitFor(() => {
    expect(scrollIntoViewMock.mock.contexts).toContain(officePlanSection);
  });
}, 15000);
