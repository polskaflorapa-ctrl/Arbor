/**
 * JWT z localStorage — odrzuca literalne "undefined"/"null", BOM/ZWSP, pusty string;
 * przy śmieciach usuwa wpis, żeby reszta aplikacji nie traktowała tego jako sesji.
 */
export function getStoredToken() {
  try {
    const raw = localStorage.getItem('token');
    if (raw == null) return null;
    const t = String(raw).replace(/[\uFEFF\u200B-\u200D]/g, '').trim();
    if (t === '' || t === 'undefined' || t === 'null') {
      try {
        localStorage.removeItem('token');
      } catch {
        /* ignore */
      }
      return null;
    }
    return t;
  } catch {
    return null;
  }
}

/** Nagłówki Authorization — pusty obiekt gdy brak poprawnego JWT (nigdy `Bearer null`). */
export function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
