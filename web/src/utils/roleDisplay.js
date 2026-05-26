export const ROLE_DISPLAY_NAMES = Object.freeze({
  Wyceniający: 'Specjalista ds. wyceny',
  Wyceniajacy: 'Specjalista ds. wyceny',
});

export function getRoleDisplayName(role, fallback = '') {
  const value = String(role || '').trim();
  if (!value) return fallback;
  return ROLE_DISPLAY_NAMES[value] || value;
}
