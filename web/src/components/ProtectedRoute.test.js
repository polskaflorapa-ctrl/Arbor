import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';
import { getRouteRoles } from '../utils/routeAccess';

function renderRestrictedRoute(role, path = '/telefonia') {
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({ id: 7, rola: role }));
  render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route
          path={path}
          element={(
            <ProtectedRoute roles={getRouteRoles(path)}>
              <div>Widok chroniony</div>
            </ProtectedRoute>
          )}
        />
        <Route path="/dashboard" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  localStorage.clear();
});

test('redirects a sidebar-only role that is not allowed by the router policy', () => {
  renderRestrictedRoute('Dyspozytor');

  expect(screen.getByText('Dashboard')).toBeInTheDocument();
  expect(screen.queryByText('Widok chroniony')).not.toBeInTheDocument();
});

test('renders the route for a role allowed by the shared policy', () => {
  renderRestrictedRoute('Kierownik');

  expect(screen.getByText('Widok chroniony')).toBeInTheDocument();
});
