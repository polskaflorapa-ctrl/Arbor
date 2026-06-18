import './i18n';
import { render, screen } from '@testing-library/react';
import App, { redirectCleanPathToHashRoute } from './App';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  localStorage.clear();
});

test('renders public landing entrypoint by default', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /Centrum operacyjne/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Wy.*lij zg.*oszenie/i })).toBeInTheDocument();
});

test('keeps login available on the login route', () => {
  window.history.replaceState(null, '', '/#/login');
  render(<App />);
  expect(screen.getByRole('heading', { name: /Zaloguj/i })).toBeInTheDocument();
  expect(screen.getByText(/Konta demonstracyjne/i)).toBeInTheDocument();
});

test('preserves clean production paths by converting them to hash routes', () => {
  window.history.replaceState(null, '', '/zlecenia?search=Anna');
  const redirected = redirectCleanPathToHashRoute();
  expect(redirected).toBe(true);
  expect(window.location.pathname).toBe('/');
  expect(window.location.hash).toBe('#/zlecenia?search=Anna');
});
