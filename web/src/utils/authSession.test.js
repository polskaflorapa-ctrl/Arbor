import {
  __getCurrentRouteForTests,
  __resetAuthSessionForTests,
  clearAuthSession,
  resetAuthSession,
} from './authSession';

describe('authSession', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetAuthSessionForTests();
  });

  afterEach(() => {
    localStorage.clear();
    __resetAuthSessionForTests();
  });

  it('clears auth-related entries from localStorage', () => {
    localStorage.setItem('token', 'jwt');
    localStorage.setItem('user', JSON.stringify({ id: 1 }));
    localStorage.setItem('permissions', JSON.stringify({ canViewFinance: true }));
    localStorage.setItem('theme', 'premium');

    clearAuthSession();

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(localStorage.getItem('permissions')).toBeNull();
    expect(localStorage.getItem('theme')).toBe('premium');
  });

  it('redirects to login only once after clearing the session', () => {
    localStorage.setItem('token', 'jwt');
    const onRedirect = vi.fn();
    const location = { pathname: '/dashboard', assign: vi.fn() };

    resetAuthSession({ location, onRedirect });
    resetAuthSession({ location, onRedirect });

    expect(localStorage.getItem('token')).toBeNull();
    expect(onRedirect).toHaveBeenCalledTimes(1);
    expect(onRedirect).toHaveBeenCalledWith('/');
  });

  it('does not redirect again when already on the login page', () => {
    const onRedirect = vi.fn();
    const location = { pathname: '/', assign: vi.fn() };

    resetAuthSession({ location, onRedirect });

    expect(onRedirect).not.toHaveBeenCalled();
  });

  it('treats hash routes as the active route for redirect decisions', () => {
    expect(__getCurrentRouteForTests({ pathname: '/', hash: '#/dashboard' })).toBe('/dashboard');
    expect(__getCurrentRouteForTests({ pathname: '/', hash: '#/' })).toBe('/');
  });

  it('redirects from a protected hash route back to login', () => {
    const onRedirect = vi.fn();
    const location = { pathname: '/', hash: '#/dashboard', assign: vi.fn() };

    resetAuthSession({ location, onRedirect });

    expect(onRedirect).toHaveBeenCalledTimes(1);
    expect(onRedirect).toHaveBeenCalledWith('/');
  });
});
