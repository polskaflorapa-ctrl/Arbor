export const ROLE_DISPLAY_NAMES = Object.freeze({
  Wyceniający: 'Specjalista ds. wyceny',
  Wyceniajacy: 'Specjalista ds. wyceny',
});

export function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (!value) return '';

  if (value.includes('wyceniaj')) return 'wyceniajacy';
  if (value.includes('dyrektor') && value.includes('sprzeda')) return 'dyrektor sprzedazy';
  if (value.includes('pomocnik') && value.includes('bez')) return 'pomocnik bez doswiadczenia';

  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function roleMatches(role, expectedRole) {
  return normalizeRole(role) === normalizeRole(expectedRole);
}

export function hasAnyRole(role, expectedRoles = []) {
  return expectedRoles.some((expectedRole) => roleMatches(role, expectedRole));
}

export function getRoleDisplayName(role, fallback = '') {
  const value = String(role || '').trim();
  if (!value) return fallback;
  const normalized = normalizeRole(value);
  if (normalized === 'wyceniajacy') return 'Specjalista ds. wyceny';
  return ROLE_DISPLAY_NAMES[value] || value;
}
