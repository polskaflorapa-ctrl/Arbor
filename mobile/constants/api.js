const DEFAULT_API_URL = 'https://arbor-os-dvf7.onrender.com/api';

const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

const resolveApiUrl = () => {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (!fromEnv) return DEFAULT_API_URL;

  const normalized = trimTrailingSlash(fromEnv.trim());
  return normalized.endsWith('/api') ? normalized : `${normalized}/api`;
};

export const API_URL = resolveApiUrl();
export const API_BASE_URL = API_URL.replace(/\/api$/, '');

/** Opcjonalnie: EXPO_PUBLIC_EXPECTED_API_VERSION=1.2.0 — ostrzeżenie w diagnostyce. */
export const EXPECTED_API_VERSION =
  typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_EXPECTED_API_VERSION
    ? String(process.env.EXPO_PUBLIC_EXPECTED_API_VERSION).trim()
    : '';
