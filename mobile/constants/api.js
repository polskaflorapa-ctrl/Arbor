const DEFAULT_API_URL = 'https://arbor-os-b7k6.onrender.com/api';

const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

const resolveApiUrl = () => {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (!fromEnv) return DEFAULT_API_URL;

  const normalized = trimTrailingSlash(fromEnv.trim());
  return normalized.endsWith('/api') ? normalized : `${normalized}/api`;
};

/** Klucz AsyncStorage dla runtime override URL (ustawiany z ekranu diagnostyki). */
export const CUSTOM_API_URL_STORAGE_KEY = 'arbor_custom_api_url';

/**
 * Zmienna mutable — aktualizowana przy starcie apki z AsyncStorage.
 * Zmień via setRuntimeApiUrl() w _layout.tsx po odczycie AsyncStorage.
 */
let _runtimeApiUrl = resolveApiUrl();

/** Pobiera aktualny URL API (uwzględnia runtime override). */
export const getApiUrl = () => _runtimeApiUrl;

/** Ustawia runtime override — wywołaj po starcie z AsyncStorage. Wymaga restartu dla pełnego efektu. */
export const setRuntimeApiUrl = (url) => {
  if (!url || !String(url).trim()) {
    _runtimeApiUrl = resolveApiUrl();
  } else {
    const normalized = trimTrailingSlash(String(url).trim());
    _runtimeApiUrl = normalized.endsWith('/api') ? normalized : `${normalized}/api`;
  }
};

export const API_URL = resolveApiUrl();
export const API_BASE_URL = API_URL.replace(/\/api$/, '');

/** Bazowy URL panelu web (CMR itd.). Domyslnie ten sam host co API bez `/api`. Nadpisz: EXPO_PUBLIC_WEB_APP_URL */
export const WEB_APP_URL = (() => {
  const fromEnv = typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_WEB_APP_URL;
  if (fromEnv && String(fromEnv).trim()) return trimTrailingSlash(String(fromEnv).trim());
  return API_BASE_URL;
})();

/** Opcjonalnie: EXPO_PUBLIC_EXPECTED_API_VERSION=1.2.0 - ostrzezenie w diagnostyce. */
export const EXPECTED_API_VERSION =
  typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_EXPECTED_API_VERSION
    ? String(process.env.EXPO_PUBLIC_EXPECTED_API_VERSION).trim()
    : '';
