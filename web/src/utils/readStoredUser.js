/**
 * Odczyt użytkownika z localStorage — osobny plik (uniknięcie zcache'owanego bundla
 * wskazującego stare linie w Sidebar/Dashboard).
 * Zawsze synchroniczny try/catch — nigdy nie rzuca SyntaxError na zewnątrz.
 */
export function readStoredUser() {
  try {
    const raw = localStorage.getItem('user');
    if (raw == null) return null;
    const t = String(raw).replace(/[\uFEFF\u200B-\u200D]/g, '').trim();
    if (t === '' || t === 'undefined' || t === 'null') return null;
    if (t.charAt(0) !== '{' && t.charAt(0) !== '[') return null;
    const obj = JSON.parse(t);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    try {
      localStorage.removeItem('user');
    } catch {
      /* ignore */
    }
    return null;
  }
}
