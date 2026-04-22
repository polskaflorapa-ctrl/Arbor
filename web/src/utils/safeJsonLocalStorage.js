/**
 * Bezpieczne odczytanie JSON z localStorage (unika crashy na "undefined" / "null" / śmieciach).
 */
export function getLocalStorageJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const t = String(raw).trim();
    if (t === '' || t === 'undefined' || t === 'null') return fallback;
    return JSON.parse(t);
  } catch {
    return fallback;
  }
}

/** Klucze, które muszą być poprawnym JSON — inaczej usuwamy wpis. */
const LOCAL_STORAGE_JSON_KEYS = new Set([
  'user',
  'zlecenia_workflow_config',
  'arbor_wynagrodzenie_wyceniajacy_reguly_v1',
  'arbor_recent_cities',
]);

/**
 * Usuwa typowe śmieci z localStorage (np. literal "undefined" z setItem(..., undefined)).
 * Wywoływane przy starcie aplikacji przed i18n i innymi czytnikami storage.
 */
export function sanitizeCorruptedLocalStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      const val = localStorage.getItem(key);
      const t0 = val == null ? '' : String(val).trim();
      if (t0 === 'undefined' || t0 === 'null') {
        localStorage.removeItem(key);
      }
    }
    for (const key of LOCAL_STORAGE_JSON_KEYS) {
      const val = localStorage.getItem(key);
      if (val == null) continue;
      const t1 = String(val).trim();
      if (t1 === '' || t1 === 'undefined' || t1 === 'null') continue;
      try {
        JSON.parse(t1);
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* quota / private mode */
  }
}

sanitizeCorruptedLocalStorage();
