import './i18n';
import { render, screen } from '@testing-library/react';
import App, { redirectCleanPathToHashRoute } from './App';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  localStorage.clear();
});

test('renders login entrypoint by default', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /Zaloguj się/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Zaloguj się/i })).toBeDisabled();
  expect(screen.getByText(/Konta demonstracyjne/i)).toBeInTheDocument();
});

test('preserves clean production paths by converting them to hash routes', () => {
  window.history.replaceState(null, '', '/zlecenia?search=Anna');
  const redirected = redirectCleanPathToHashRoute();
  expect(redirected).toBe(true);
  expect(window.location.pathname).toBe('/');
  expect(window.location.hash).toBe('#/zlecenia?search=Anna');
});
