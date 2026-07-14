import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ClientPortal, { mapTrackingPayload } from './ClientPortal';

function renderPortal(path = '/portal-klienta') {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/portal-klienta" element={<ClientPortal />} />
        <Route path="/portal-klienta/:token" element={<ClientPortal />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('renders the active client portal from the approved template', () => {
  renderPortal();

  expect(screen.getByRole('img', { name: 'Polska Flora' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Pielęgnacja i wycinka — al. Klonowa 5' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Status realizacji' })).toBeInTheDocument();
  expect(screen.getByText('Prace w toku')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Biuro obsługi/i })).toHaveAttribute('href', 'tel:+48221002030');
  expect(screen.getByRole('link', { name: /Zadzwoń do brygadzisty/i })).toHaveAttribute('href', 'tel:+48500100100');
  expect(screen.getByText('Oferta.pdf')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '68');
});

test('loads safe live tracking data for a token route', async () => {
  const token = 'tok_live_status_1234567890';
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      task: {
        id: 551,
        status: 'W_Realizacji',
        status_label: 'Realizacja w toku',
        service: 'Pielęgnacja dębu',
        planned_date: '2026-07-18T08:00:00.000Z',
        planned_date_label: '18 lipca 2026',
        address: 'ul. Leśna 12, Kraków',
        branch: { name: 'Oddział Kraków', phone: '+48121234567' },
        team_visible: 'Ekipa K2',
      },
      timeline: [
        { status: 'Nowe', at: '2026-07-10T08:12:00.000Z' },
        { status: 'Zaplanowane', at: '2026-07-12T09:40:00.000Z' },
        { status: 'W_Realizacji', at: '2026-07-13T10:05:00.000Z' },
      ],
    }),
  });
  vi.stubGlobal('fetch', fetchMock);

  renderPortal(`/portal-klienta/${token}`);

  expect(await screen.findByRole('heading', { name: 'Pielęgnacja dębu' })).toBeInTheDocument();
  expect(screen.getByText('ul. Leśna 12, Kraków')).toBeInTheDocument();
  expect(screen.getByText('Ekipa K2')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Zadzwoń do biura/i })).toHaveAttribute('href', 'tel:+48121234567');
  expect(screen.queryByText('Oferta.pdf')).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    `/track/${token}`,
    expect.objectContaining({
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
    })
  );
});

test('rejects malformed public tokens without making a request', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  renderPortal('/portal-klienta/short-token');

  expect(await screen.findByRole('alert')).toHaveTextContent(/nieprawidłowy format/i);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('maps a completed tracking payload to the fifth completed stage', () => {
  const result = mapTrackingPayload({
    task: {
      id: 42,
      status: 'Zakonczone',
      status_label: 'Zakończone',
      service: 'Wycinka drzewa',
      branch: {},
    },
    timeline: [],
  });

  expect(result.order.progress).toBe(100);
  expect(result.order.statusTone).toBe('green');
  expect(result.steps[4].state).toBe('current');
});
