/**
 * ARBOR-OS: Centralny klient HTTP
 * Automatycznie dodaje token JWT do każdego żądania
 * i przekierowuje do loginu gdy token wygaśnie (401)
 */
import axios from 'axios';
import { getStoredToken } from './utils/storedToken';

const RAW_API_URL = (process.env.REACT_APP_API_URL || '').trim();
/** CRA dev: REACT_APP_API_URL=/api + `src/setupProxy.js` (ARBOR_API_PROXY_TARGET) — omija CORS. */
const API_URL = RAW_API_URL || '/api';
let isRedirectingToLogin = false;
const API_URL_WITHOUT_API_SUFFIX = API_URL.replace(/\/api\/?$/, '');
const HAS_VALID_API_FALLBACK_BASE =
  Boolean(API_URL_WITHOUT_API_SUFFIX) &&
  API_URL_WITHOUT_API_SUFFIX !== API_URL;
const isUnsafeFallbackBase = API_URL_WITHOUT_API_SUFFIX === '/' || API_URL_WITHOUT_API_SUFFIX === '.';

const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
});

const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set(['ECONNABORTED', 'ERR_NETWORK']);
const NETWORK_RETRY_DELAY_MS = 400;
const NETWORK_COOLDOWN_MS = 3000;
const inFlightGetRequests = new Map();
let networkCooldownUntil = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableStringify(value) {
  if (!value || typeof value !== 'object') return String(value ?? '');
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${key}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function buildGetDedupeKey(url, config = {}) {
  const baseURL = config.baseURL || api.defaults.baseURL || '';
  const paramsKey = stableStringify(config.params || {});
  return `${baseURL}|${url}|${paramsKey}`;
}

const originalGet = api.get.bind(api);
api.get = (url, config = {}) => {
  if (config?.dedupe === false) {
    return originalGet(url, config);
  }

  const key = buildGetDedupeKey(url, config);
  const inFlight = inFlightGetRequests.get(key);
  if (inFlight) return inFlight;

  const request = originalGet(url, config).finally(() => {
    inFlightGetRequests.delete(key);
  });
  inFlightGetRequests.set(key, request);
  return request;
};

function buildRequestDebug(config, response) {
  const method = (config?.method || 'get').toUpperCase();
  const baseURL = config?.baseURL || api.defaults.baseURL || '';
  const urlPath = config?.url || '';
  let fullUrl = `${baseURL}${urlPath}`;
  try {
    if (baseURL && urlPath) {
      fullUrl = new URL(urlPath, baseURL).toString();
    }
  } catch {
    // Fallback to concatenation when URL cannot be resolved.
  }

  return {
    method,
    baseURL,
    urlPath,
    fullUrl,
    status: response?.status,
    responseData: response?.data,
  };
}

// ── Request interceptor: dodaj token do każdego żądania ───────────────────────
api.interceptors.request.use(
  (config) => {
    const method = String(config?.method || 'get').toLowerCase();
    if (method === 'get' && Date.now() < networkCooldownUntil) {
      const cooldownError = new Error('Network cooldown in progress');
      cooldownError.code = 'ERR_NETWORK_COOLDOWN';
      cooldownError.userMessage = 'Sieć chwilowo przeciążona. Ponawiam za moment.';
      return Promise.reject(cooldownError);
    }

    const token = getStoredToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor: obsługa 401 (token wygasł) ─────────────────────────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config || {};
    const requestDebug = buildRequestDebug(config, error.response);
    error.requestDebug = requestDebug;
    const canRetryWithoutApiPrefix =
      error.response?.status === 404 &&
      !config._retriedWithoutApiPrefix &&
      typeof config.url === 'string' &&
      config.url.startsWith('/') &&
      HAS_VALID_API_FALLBACK_BASE;

    if (canRetryWithoutApiPrefix) {
      config._retriedWithoutApiPrefix = true;
      const retryBaseURL = isUnsafeFallbackBase ? API_URL : API_URL_WITHOUT_API_SUFFIX;
      return api.request({
        ...config,
        baseURL: retryBaseURL,
      });
    }

    const method = String(config.method || 'get').toLowerCase();
    const canRetryNetworkRequest =
      method === 'get' &&
      !config._retriedNetworkOnce &&
      (RETRYABLE_ERROR_CODES.has(error.code) || RETRYABLE_STATUS_CODES.has(error.response?.status));

    if (canRetryNetworkRequest) {
      config._retriedNetworkOnce = true;
      await sleep(NETWORK_RETRY_DELAY_MS);
      return api.request(config);
    }

    if (error.code === 'ECONNABORTED') {
      networkCooldownUntil = Date.now() + NETWORK_COOLDOWN_MS;
      error.userMessage = 'Przekroczono czas oczekiwania na odpowiedź serwera.';
    } else if (error.code === 'ERR_NETWORK') {
      networkCooldownUntil = Date.now() + NETWORK_COOLDOWN_MS;
      error.userMessage = `Brak połączenia z serwerem (${requestDebug.fullUrl || API_URL}).`;
    } else if (error.code === 'ERR_NETWORK_COOLDOWN') {
      error.userMessage = 'Sieć chwilowo przeciążona. Ponawiam za moment.';
    } else if (error.response?.status === 404) {
      error.userMessage = `Nie znaleziono zasobu API (${requestDebug.method} ${requestDebug.fullUrl || requestDebug.urlPath}).`;
    } else if (error.response?.status === 502 || error.response?.status === 504) {
      networkCooldownUntil = Date.now() + NETWORK_COOLDOWN_MS;
      error.userMessage =
        'Backend API nie odpowiada (brama/proxy). Uruchom API: w katalogu projektu `npm run server` lub `cd server && npm start` ' +
        '(domyślnie http://localhost:3001). W dev CRA żądania `/api` idą tam przez `src/setupProxy.js` — ustaw `ARBOR_API_PROXY_TARGET` w `.env.local`, jeśli API jest na innym hoście/porcie.';
    } else if (error.response?.status >= 500) {
      networkCooldownUntil = Date.now() + NETWORK_COOLDOWN_MS;
      error.userMessage = `Błąd serwera API (${requestDebug.method} ${requestDebug.fullUrl || requestDebug.urlPath}).`;
    }

    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');

      const isOnLoginPage = window.location.pathname === '/';
      if (!isOnLoginPage && !isRedirectingToLogin) {
        isRedirectingToLogin = true;
        window.location.assign('/');
      }
    }

    if (process.env.NODE_ENV !== 'production' && error.response?.status >= 400) {
      console.warn('[api] request failed', requestDebug);
    }

    return Promise.reject(error);
  }
);

export const API = API_URL;
export default api;
