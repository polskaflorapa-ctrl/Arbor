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

// --- Ochrona przed spietrzeniem zadan gdy API pada (bylo issue #81) ---
// Semafor: najwyzej MAX_CONCURRENT rownoczesnych zapytan; nadmiar czeka w kolejce
// (przegladarka i tak limituje ~6/host — bez tego setki ekranow strzelaja naraz
// przy niedostepnym API i wyczerpuja sloty polaczen -> ERR_INSUFFICIENT_RESOURCES).
// Circuit-breaker: po serii bledow SIECI krotko odrzucamy natychmiast (cooldown),
// zeby UI nie zamarzal na tysiacach zawisajacych preflightow. Bledy HTTP (4xx/5xx)
// NIE licza sie jako awaria sieci — to poprawne odpowiedzi serwera.
const MAX_CONCURRENT = 6;
const BREAKER_FAILURE_THRESHOLD = 8;
const BREAKER_COOLDOWN_MS = 5_000;

let inFlight = 0;
const waiters: (() => void)[] = [];
let consecutiveNetworkFailures = 0;
let breakerOpenUntil = 0;

function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function releaseSlot(): void {
  const next = waiters.shift();
  if (next) next();
  else inFlight = Math.max(0, inFlight - 1);
}

export class ApiUnavailableError extends Error {
  constructor(message = 'API chwilowo niedostepne — ponow za chwile.') {
    super(message);
    this.name = 'ApiUnavailableError';
  }
}

export function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  if (Date.now() < breakerOpenUntil) {
    // Bezpiecznik otwarty: nie spietrzaj kolejnych zadan do martwego backendu.
    return Promise.reject(new ApiUnavailableError());
  }
  return acquireSlot().then(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(input, {
      ...init,
      signal: init.signal || controller.signal,
    }).then(
      (res) => {
        // Odpowiedz serwera (nawet 5xx) = siec dziala -> reset bezpiecznika.
        consecutiveNetworkFailures = 0;
        return res;
      },
      (err) => {
        // Odrzucony fetch = blad sieci/preflightu. Zliczaj; po progu otworz bezpiecznik.
        consecutiveNetworkFailures += 1;
        if (consecutiveNetworkFailures >= BREAKER_FAILURE_THRESHOLD) {
          breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
        }
        throw err;
      },
    ).finally(() => {
      clearTimeout(timeout);
      releaseSlot();
    });
  });
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
