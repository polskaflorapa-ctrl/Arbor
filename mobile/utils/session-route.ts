export type SessionRouteRedirect = '/dashboard' | '/login' | null;

function normalizePathname(pathname: string): string {
  const normalized = String(pathname || '/')
    .split(/[?#]/, 1)[0]
    .replace(/\/+$/, '');
  return normalized || '/';
}

/**
 * Root-level session boundary for Expo Router.
 * Index and login stay public. Keeping login public also prevents redirect
 * loops when a legacy screen navigates there after HTTP 401 before token cleanup.
 */
export function getSessionRouteRedirect(
  pathname: string,
  hasSession: boolean,
): SessionRouteRedirect {
  const path = normalizePathname(pathname);
  if (path === '/' || path === '/login') return null;
  return hasSession ? null : '/login';
}
