import '../i18n';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import Crm from './Crm';

vi.mock('../components/CommandSidebar', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../components/PageHeader', () => ({
  __esModule: true,
  default: ({ title, subtitle, actions }) => (
    <header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {actions}
    </header>
  ),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'crm-smoke-token');
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('renders CRM hub and navigates with the shared Pipeline button', async () => {
  render(
    <MemoryRouter initialEntries={['/crm']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/crm" element={<><Crm /><LocationProbe /></>} />
        <Route path="/crm/pipeline" element={<><div>Pipeline route</div><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>
  );

  expect(await screen.findByRole('heading', { name: /crm/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pipeline' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Pipeline' }));

  expect(await screen.findByText('Pipeline route')).toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent('/crm/pipeline');
});
