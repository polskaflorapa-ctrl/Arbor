const AUTH_STORAGE_KEYS = ['token', 'user', 'permissions'];

let isRedirectingToLogin = false;

function normalizeRoute(value) {
  if (!value) return '/';
  const normalized = String(value).trim();
  if (!normalized) return '/';
  return normalized.startsWith('#') ? normalized.slice(1) || '/' : normalized;
}

function getCurrentRoute(location) {
  const hashRoute = normalizeRoute(location?.hash);
  if (hashRoute && hashRoute !== '/') return hashRoute;
  return normalizeRoute(location?.pathname);
}

export function clearAuthSession() {
  if (typeof localStorage === 'undefined') return;
  AUTH_STORAGE_KEYS.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore storage failures */
    }
  });
}

export function resetAuthSession({
  redirect = true,
  redirectTo = '/',
  location = typeof window !== 'undefined' ? window.location : null,
  onRedirect,
} = {}) {
  clearAuthSession();

  if (!redirect) return;

  const currentRoute = getCurrentRoute(location);
  if (currentRoute === normalizeRoute(redirectTo) || isRedirectingToLogin) return;

  isRedirectingToLogin = true;
  if (typeof onRedirect === 'function') {
    onRedirect(redirectTo);
    return;
  }

  location?.assign?.(redirectTo);
}

export function __resetAuthSessionForTests() {
  isRedirectingToLogin = false;
}

export function __getCurrentRouteForTests(location) {
  return getCurrentRoute(location);
}
