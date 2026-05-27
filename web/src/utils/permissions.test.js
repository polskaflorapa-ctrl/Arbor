import {
  isDyrektor,
  isFieldWorker,
  isKierownik,
  isSalesDirector,
  readPermissions,
} from './permissions';

describe('permissions role helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('normalizes management role variants', () => {
    expect(isDyrektor('Dyrektor')).toBe(true);
    expect(isKierownik('Kierownik')).toBe(true);
    expect(isSalesDirector('Dyrektor Sprzedaży')).toBe(true);
    expect(isSalesDirector('Dyrektor Sprzedazy')).toBe(true);
  });

  test('normalizes field worker role variants', () => {
    expect(isFieldWorker('Brygadzista')).toBe(true);
    expect(isFieldWorker('Pomocnik')).toBe(true);
    expect(isFieldWorker('Specjalista')).toBe(false);
  });

  test('builds estimator fallback permissions for non-diacritic role', () => {
    localStorage.setItem('user', JSON.stringify({ rola: 'Wyceniajacy' }));
    const permissions = readPermissions();

    expect(permissions.canViewSettlementModule).toBe(true);
    expect(permissions.canViewCrm).toBe(true);
    expect(permissions.taskScope).toBe('branch');
  });
});
