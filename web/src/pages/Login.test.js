import '../i18n';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import Login from './Login';
import api from '../api';

vi.mock('../api', () => ({
  __esModule: true,
  default: {
    post: vi.fn(),
  },
}));

vi.mock('../components/LanguageSwitcher', () => ({
  __esModule: true,
  default: () => <div data-testid="language-switcher" />,
}));

function renderLogin({ initialEntries = ['/'] } = {}) {
  return render(
    <MemoryRouter
      initialEntries={initialEntries}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/dashboard" element={<div>Dashboard gotowy</div>} />
        <Route path="/zlecenia" element={<div>Zlecenia gotowe</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function getLoginFields(container) {
  return {
    loginInput: container.querySelector('input[autocomplete="username"]'),
    passwordInput: container.querySelector('input[autocomplete="current-password"]'),
    rememberInput: container.querySelector('input[type="checkbox"]'),
    submitButton: container.querySelector('button[type="submit"]'),
  };
}

async function click(element) {
  await act(async () => {
    await userEvent.click(element);
  });
}

async function type(element, value) {
  await act(async () => {
    await userEvent.type(element, value);
  });
}

beforeEach(() => {
  localStorage.clear();
  api.post.mockReset();
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('fills a demo account and stores session data after login', async () => {
  api.post.mockResolvedValue({
    data: {
      token: 'demo-token',
      user: { id: 7, rola: 'Dyrektor', imie: 'Demo', permissions: ['dashboard:view'] },
    },
  });

  const { container } = renderLogin();
  const { loginInput, passwordInput, rememberInput, submitButton } = getLoginFields(container);

  await click(screen.getByRole('button', { name: /Dyrektor/ }));
  expect(loginInput).toHaveValue('dyrektor');
  expect(passwordInput).toHaveValue('ArborDemo2026!');

  await click(rememberInput);
  await click(submitButton);

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith('/auth/login', {
      login: 'dyrektor',
      haslo: 'ArborDemo2026!',
    });
  });
  expect(localStorage.getItem('token')).toBe('demo-token');
  expect(JSON.parse(localStorage.getItem('user'))).toMatchObject({ rola: 'Dyrektor' });
  expect(JSON.parse(localStorage.getItem('permissions'))).toEqual(['dashboard:view']);
  expect(localStorage.getItem('remembered_login')).toBe('dyrektor');
  expect(await screen.findByText('Dashboard gotowy')).toBeInTheDocument();
});

test('returns to the protected route requested before login', async () => {
  api.post.mockResolvedValue({
    data: {
      token: 'demo-token',
      user: { id: 7, rola: 'Dyrektor', imie: 'Demo' },
    },
  });

  const { container } = renderLogin({
    initialEntries: [{ pathname: '/', state: { from: '/zlecenia?search=Anna' } }],
  });
  const { loginInput, passwordInput, submitButton } = getLoginFields(container);

  await type(loginInput, 'demo_dyrektor');
  await type(passwordInput, 'Demo123!ARBOR');
  await click(submitButton);

  expect(await screen.findByText('Zlecenia gotowe')).toBeInTheDocument();
});

test('restores remembered login without requiring a token', () => {
  localStorage.setItem('remembered_login', 'demo_prezes');

  const { container } = renderLogin();
  const { loginInput, rememberInput } = getLoginFields(container);

  expect(loginInput).toHaveValue('demo_prezes');
  expect(rememberInput).toBeChecked();
  expect(screen.queryByText('Dashboard gotowy')).not.toBeInTheDocument();
});

test('clears stale auth entries when login response is missing token or user', async () => {
  localStorage.setItem('user', JSON.stringify({ id: 99, rola: 'Dyrektor' }));
  localStorage.setItem('permissions', JSON.stringify({ canViewFinance: true }));
  api.post.mockResolvedValue({ data: { token: '', user: null } });

  const { container } = renderLogin();
  const { loginInput, passwordInput, submitButton } = getLoginFields(container);

  await type(loginInput, 'demo_dyrektor');
  await type(passwordInput, 'Demo123!ARBOR');
  await click(submitButton);

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith('/auth/login', {
      login: 'demo_dyrektor',
      haslo: 'Demo123!ARBOR',
    });
  });

  expect(localStorage.getItem('token')).toBeNull();
  expect(localStorage.getItem('user')).toBeNull();
  expect(localStorage.getItem('permissions')).toBeNull();
  expect(passwordInput).toHaveValue('');
  expect(screen.queryByText('Dashboard gotowy')).not.toBeInTheDocument();
  await waitFor(() => {
    expect(screen.queryByText('Dashboard gotowy')).not.toBeInTheDocument();
    expect(passwordInput).toHaveValue('');
  });
});

test('requests a password reset link by login or email', async () => {
  api.post.mockResolvedValue({
    data: {
      message: 'Jeśli konto istnieje i ma adres e-mail, wysłaliśmy link resetujący hasło.',
      dev_reset_url: 'http://localhost:3005/#/login?resetToken=abc',
    },
  });

  renderLogin();

  await click(screen.getByRole('button', { name: 'Nie pamiętasz hasła?' }));
  await type(screen.getByLabelText('Login albo e-mail'), 'admin@arbor.local');
  await click(screen.getByRole('button', { name: 'Wyślij link' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith('/auth/forgot-password', {
      identifier: 'admin@arbor.local',
    });
  });
  expect(await screen.findByText(/wysłaliśmy link resetujący hasło/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Otwórz link resetujący (dev)' })).toHaveAttribute(
    'href',
    'http://localhost:3005/#/login?resetToken=abc',
  );
});

test('resets password from a reset token link', async () => {
  api.post.mockResolvedValue({
    data: {
      ok: true,
      message: 'Hasło zostało zmienione. Możesz się zalogować.',
    },
  });

  renderLogin({ initialEntries: ['/?resetToken=abc-token'] });

  expect(screen.getByText('Ustaw nowe hasło')).toBeInTheDocument();
  await type(screen.getByLabelText('Nowe hasło'), 'NoweHaslo123');
  await type(screen.getByLabelText('Powtórz hasło'), 'NoweHaslo123');
  await click(screen.getByRole('button', { name: 'Zmień hasło' }));

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith('/auth/reset-password', {
      token: 'abc-token',
      haslo: 'NoweHaslo123',
    });
  });
  expect(await screen.findByText('Hasło zostało zmienione. Możesz się zalogować.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Zaloguj się' })).toBeInTheDocument();
});

test('shows a login error and clears the password after failed auth', async () => {
  api.post.mockRejectedValue({
    response: { data: { error: 'Nieprawidlowe dane logowania' } },
  });

  const { container } = renderLogin();
  const { loginInput, passwordInput, submitButton } = getLoginFields(container);

  await type(loginInput, 'demo_dyrektor');
  await type(passwordInput, 'zle-haslo');
  await click(submitButton);

  expect(await screen.findByText('Nieprawidlowe dane logowania')).toBeInTheDocument();
  expect(passwordInput).toHaveValue('');
  expect(localStorage.getItem('token')).toBeNull();
});
