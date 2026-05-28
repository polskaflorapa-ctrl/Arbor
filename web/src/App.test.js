import './i18n';
import { render, screen } from '@testing-library/react';
import App, { redirectCleanPathToHashRoute } from './App';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  localStorage.clear();
});

test('renders login screen by default', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /ARBOR-OS/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Zaloguj/i })).toBeInTheDocument();
});

test('preserves clean production paths by converting them to hash routes', () => {
  window.history.replaceState(null, '', '/zlecenia?search=Anna');
  const redirected = redirectCleanPathToHashRoute();
  expect(redirected).toBe(true);
  expect(window.location.pathname).toBe('/');
  expect(window.location.hash).toBe('#/zlecenia?search=Anna');
});
