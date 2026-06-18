import { getApiUrl } from '../constants/api';

type ApiHeaders = Record<string, string>;
const DEFAULT_TIMEOUT_MS = 12_000;

export interface ApiFetchOptions extends Omit<RequestInit, 'headers'> {
  token?: string | null;
  headers?: ApiHeaders;
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiUrl()}${normalizedPath}`;
}

export function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, {
    ...init,
    signal: init.signal || controller.signal,
  }).finally(() => clearTimeout(timeout));
}

export function authHeaders(token?: string | null, headers: ApiHeaders = {}): ApiHeaders {
  return token ? { ...headers, Authorization: `Bearer ${token}` } : { ...headers };
}

export function jsonHeaders(token?: string | null, headers: ApiHeaders = {}): ApiHeaders {
  return authHeaders(token, { 'Content-Type': 'application/json', ...headers });
}

export function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { token, headers, ...init } = options;
  return fetchWithTimeout(apiUrl(path), {
    ...init,
    headers: authHeaders(token, headers),
  });
}

export function apiJsonFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { token, headers, ...init } = options;
  return fetchWithTimeout(apiUrl(path), {
    ...init,
    headers: jsonHeaders(token, headers),
  });
}

export async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json();
    return String(payload?.error || payload?.message || fallback);
  } catch {
    return fallback;
  }
}
