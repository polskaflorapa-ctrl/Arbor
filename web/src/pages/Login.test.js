import '../i18n';
import { render, screen, waitFor } from '@testing-library/react';
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

function renderLogin() {
  return render(
    <MemoryRouter
      initialEntries={['/']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/dashboard" element={<div>Dashboard gotowy</div>} />
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

  await userEvent.click(screen.getByRole('button', { name: /Dyrektor/ }));
  expect(loginInput).toHaveValue('demo_dyrektor');
  expect(passwordInput).toHaveValue('Demo123!ARBOR');

  await userEvent.click(rememberInput);
  await userEvent.click(submitButton);

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith('/auth/login', {
      login: 'demo_dyrektor',
      haslo: 'Demo123!ARBOR',
    });
  });
  expect(localStorage.getItem('token')).toBe('demo-token');
  expect(JSON.parse(localStorage.getItem('user'))).toMatchObject({ rola: 'Dyrektor' });
  expect(JSON.parse(localStorage.getItem('permissions'))).toEqual(['dashboard:view']);
  expect(localStorage.getItem('remembered_login')).toBe('demo_dyrektor');
  expect(await screen.findByText('Dashboard gotowy')).toBeInTheDocument();
});

test('restores remembered login without requiring a token', () => {
  localStorage.setItem('remembered_login', 'demo_prezes');

  const { container } = renderLogin();
  const { loginInput, rememberInput } = getLoginFields(container);

  expect(loginInput).toHaveValue('demo_prezes');
  expect(rememberInput).toBeChecked();
  expect(screen.queryByText('Dashboard gotowy')).not.toBeInTheDocument();
});

test('shows a login error and clears the password after failed auth', async () => {
  api.post.mockRejectedValue({
    response: { data: { error: 'Nieprawidlowe dane logowania' } },
  });

  const { container } = renderLogin();
  const { loginInput, passwordInput, submitButton } = getLoginFields(container);

  await userEvent.type(loginInput, 'demo_dyrektor');
  await userEvent.type(passwordInput, 'zle-haslo');
  await userEvent.click(submitButton);

  expect(await screen.findByText('Nieprawidlowe dane logowania')).toBeInTheDocument();
  expect(passwordInput).toHaveValue('');
  expect(localStorage.getItem('token')).toBeNull();
});
