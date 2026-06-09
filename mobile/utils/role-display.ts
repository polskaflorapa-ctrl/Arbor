export const ROLE_DISPLAY_NAMES: Record<string, string> = {
  Wyceniający: 'Specjalista oględzin',
  Wyceniajacy: 'Specjalista oględzin',
};

export function getRoleDisplayName(role: unknown, fallback = '') {
  const value = String(role || '').trim();
  if (!value) return fallback;
  return ROLE_DISPLAY_NAMES[value] || value;
}
