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

    if (error.code === 'ECONNABORTED') {
      error.userMessage = 'Przekroczono czas oczekiwania na odpowiedź serwera.';
    } else if (error.code === 'ERR_NETWORK') {
      error.userMessage = `Brak połączenia z serwerem (${requestDebug.fullUrl || API_URL}).`;
    } else if (error.response?.status === 404) {
      error.userMessage = `Nie znaleziono zasobu API (${requestDebug.method} ${requestDebug.fullUrl || requestDebug.urlPath}).`;
    } else if (error.response?.status === 502 || error.response?.status === 504) {
      error.userMessage =
        'Backend API nie odpowiada (brama/proxy). Uruchom API: w katalogu projektu `npm run server` lub `cd server && npm start` ' +
        '(domyślnie http://localhost:3001). W dev CRA żądania `/api` idą tam przez `src/setupProxy.js` — ustaw `ARBOR_API_PROXY_TARGET` w `.env.local`, jeśli API jest na innym hoście/porcie.';
    } else if (error.response?.status >= 500) {
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
