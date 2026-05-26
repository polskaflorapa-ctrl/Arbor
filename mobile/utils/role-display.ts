export const ROLE_DISPLAY_NAMES: Record<string, string> = {
  Wyceniający: 'Specjalista ds. wyceny',
  Wyceniajacy: 'Specjalista ds. wyceny',
};

export function getRoleDisplayName(role: unknown, fallback = '') {
  const value = String(role || '').trim();
  if (!value) return fallback;
  return ROLE_DISPLAY_NAMES[value] || value;
}
