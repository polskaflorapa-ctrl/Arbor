import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DevPanel } from './DevPanel';

vi.mock('../utils/apiBase', () => ({
  getReactApiBase: () => '/api',
}));

vi.mock('../utils/authSession', () => ({
  clearAuthSession: vi.fn(),
}));

vi.mock('../utils/storedToken', () => ({
  getStoredToken: vi.fn(() => 'test-jwt'),
}));

vi.mock('../utils/testMode', async () => {
  const actual = await vi.importActual('../utils/testMode');
  return {
    ...actual,
    isTestModeEnabled: vi.fn(() => false),
    toggleTestMode: vi.fn(),
  };
});

describe('DevPanel invalid session helper', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('writes an invalid token and reloads the dashboard route', () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        hash: '#/',
        reload: reloadMock,
      },
    });

    render(<DevPanel />);

    fireEvent.keyDown(window, { key: 'd', ctrlKey: true, shiftKey: true });

    expect(screen.getByText('🛠️ Dev Panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Symuluj niewazny token/i }));

    expect(localStorage.getItem('token')).toMatch(/^invalid_dev_token_/);
    expect(JSON.parse(localStorage.getItem('user'))).toMatchObject({
      id: 9001,
      rola: 'Dyrektor',
    });
    expect(window.location.hash).toBe('#/dashboard');
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
