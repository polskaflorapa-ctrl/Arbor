import './i18n';
import { render, screen } from '@testing-library/react';
import App, { redirectCleanPathToHashRoute } from './App';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  localStorage.clear();
});

test('renders landing page by default with a login entrypoint', () => {
  render(<App />);
  expect(
    screen.getByRole('heading', {
      name: /Prowadź operacje terenowe z jednego spokojnego centrum dowodzenia/i,
    })
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Zaloguj/i })).toHaveAttribute('href', '#/login');
});

test('preserves clean production paths by converting them to hash routes', () => {
  window.history.replaceState(null, '', '/zlecenia?search=Anna');
  const redirected = redirectCleanPathToHashRoute();
  expect(redirected).toBe(true);
  expect(window.location.pathname).toBe('/');
  expect(window.location.hash).toBe('#/zlecenia?search=Anna');
});
