import { getRoleDisplayName, hasAnyRole, normalizeRole, roleMatches } from './roleDisplay';

describe('roleDisplay role helpers', () => {
  test('normalizes estimator role variants', () => {
    expect(normalizeRole('Wyceniający')).toBe('wyceniajacy');
    expect(normalizeRole('Wyceniajacy')).toBe('wyceniajacy');
    expect(normalizeRole('WyceniajÄ…cy')).toBe('wyceniajacy');
  });

  test('matches sales director variants', () => {
    expect(roleMatches('Dyrektor Sprzedaży', 'Dyrektor Sprzedazy')).toBe(true);
    expect(roleMatches('Dyrektor dzialu sprzedaz', 'Dyrektor działu sprzedaż')).toBe(true);
  });

  test('checks role lists with normalized comparison', () => {
    expect(hasAnyRole('Pomocnik bez doĹ›wiadczenia', ['Pomocnik bez doświadczenia'])).toBe(true);
    expect(hasAnyRole('Magazynier', ['Kierownik', 'Dyrektor'])).toBe(false);
  });

  test('keeps estimator display name stable', () => {
    expect(getRoleDisplayName('Wyceniajacy')).toBe('Specjalista ds. wyceny');
    expect(getRoleDisplayName('Wyceniający')).toBe('Specjalista ds. wyceny');
  });
});
