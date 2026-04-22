import { normalizeCityName } from './cityFormat';
import {
  clearRecentCities,
  getRecentCities,
  mergeCitySuggestions,
  saveRecentCity,
} from './citySuggestions';

describe('normalizeCityName', () => {
  test('normalizes casing and spacing', () => {
    expect(normalizeCityName('  nowy   sacz  ')).toBe('Nowy Sącz');
  });

  test('maps non-diacritic city to canonical Polish city', () => {
    expect(normalizeCityName('lodz')).toBe('Łódź');
    expect(normalizeCityName('bielsko-biala')).toBe('Bielsko-Biała');
  });
});

describe('recent city suggestions', () => {
  const STORAGE_KEY = 'arbor_recent_cities';

  beforeEach(() => {
    clearRecentCities();
  });

  test('saves recent cities without duplicates', () => {
    saveRecentCity('Warszawa');
    saveRecentCity('Kraków');
    saveRecentCity('warszawa');

    expect(getRecentCities()).toEqual(['warszawa', 'Kraków']);
  });

  test('places recent cities first in merged suggestions', () => {
    saveRecentCity('Rzeszów');
    const list = mergeCitySuggestions(['MyCity']);

    expect(list[0]).toBe('Rzeszów');
    expect(list).toContain('MyCity');
    expect(list).toContain('Warszawa');
  });

  test('respects max suggestion limit', () => {
    const list = mergeCitySuggestions(['A', 'B', 'C'], { maxItems: 3 });
    expect(list.length).toBeLessThanOrEqual(3);
  });

  test('clears recent cities list', () => {
    saveRecentCity('Warszawa');
    expect(getRecentCities().length).toBeGreaterThan(0);
    clearRecentCities();
    expect(getRecentCities()).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
