import './i18n';
import { render, screen } from '@testing-library/react';
import App, { redirectCleanPathToHashRoute } from './App';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  localStorage.clear();
});

test('renders login page by default as the app entrypoint', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /ARBOR-OS/i, level: 1 })).toBeInTheDocument();
  expect(screen.getByLabelText(/login/i)).toBeInTheDocument();
});

test('preserves clean production paths by converting them to hash routes', () => {
  window.history.replaceState(null, '', '/zlecenia?search=Anna');
  const redirected = redirectCleanPathToHashRoute();
  expect(redirected).toBe(true);
  expect(window.location.pathname).toBe('/');
  expect(window.location.hash).toBe('#/zlecenia?search=Anna');
});

test('routes /crm to the CRM hub instead of the lead pipeline', async () => {
  window.history.replaceState(null, '', '/#/crm');
  localStorage.setItem('token', 'test-token');
  localStorage.setItem(
    'user',
    JSON.stringify({
      id: 1,
      imie: 'Anna',
      nazwisko: 'Sprzedaz',
      rola: 'Dyrektor',
    })
  );

  render(<App />);

  expect(await screen.findByText(/Webhooki, logi/i, {}, { timeout: 5000 })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Pipeline lead/i })).toBeInTheDocument();
  expect(screen.queryByText(/Kommo-style pipeline/i)).not.toBeInTheDocument();
});
